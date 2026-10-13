-- GeoBarkr 002: game logic (ServiceNow: GeoBarkrUtils, geoBarkrAjax and the
-- "Calculate Score for Guess" business rule). Safe to re-run.
--
-- Players never write game tables directly. Every change goes through one of
-- these functions, which run with the owner's rights (security definer), check
-- who is calling with auth.uid(), and then broadcast a Realtime event on the
-- game's private channel "game:<id>" so every screen refreshes.

-- ---------- Helpers ----------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- The host of a game or one of its players.
create or replace function public.is_game_member(p_game uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.games where id = p_game and host_id = auth.uid())
      or exists (select 1 from public.game_players where game_id = p_game and user_id = auth.uid());
$$;

-- Who may listen to a Realtime topic: "game:<id>" for that game's members.
create or replace function public.can_listen(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_topic is null or p_topic !~ '^game:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_game_member(substr(p_topic, 6)::uuid) or public.is_admin();
end;
$$;

-- Great-circle distance in km (haversine, R = 6371 km), as calculateDistanceBetweenPoints.
create or replace function public.haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 6371 * 2 * atan2(sqrt(a), sqrt(1 - a))
  from (
    -- Clamped: rounding can push a just past 1 for near-opposite points.
    select least(1, greatest(0, sin(radians(lat2 - lat1) / 2) ^ 2
         + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2)) as a
  ) x;
$$;

-- Whole km from 10 km up, otherwise 0.1 km (JavaScript Math.round: halves round up).
create or replace function public.round_distance_km(d double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case when d >= 10 then floor(d + 0.5) else floor(d * 10 + 0.5) / 10 end;
$$;

-- 5000 × e^(−metres / 2,000,000), rounded; 5000 under 10 m (calculateScoreFromDistance).
create or replace function public.score_for_distance(km double precision)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when km * 1000 < 10 then 5000
    else greatest(0, floor(5000 * exp(-(km * 1000) / 2000000.0) + 0.5))::integer
  end;
$$;

-- Six characters with no look-alikes (no I, L, O, 0 or 1).
create or replace function public.new_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.games where code = candidate);
  end loop;
  return candidate;
end;
$$;

-- Tell every screen in a game that something changed. A failed broadcast never
-- blocks the game: screens also refresh on a timer.
create or replace function public.notify_game(p_game uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(jsonb_build_object('game_id', p_game, 'event', p_event), p_event, 'game:' || p_game::text, true);
exception when others then
  raise warning 'GeoBarkr broadcast failed: %', sqlerrm;
end;
$$;

create or replace function public.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to play' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- ---------- New users ----------

-- Every new account gets a profile, named from Google or the email address,
-- with Google's profile photo when there is one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Player'
    ), 40),
    -- Google's profile photo, if any.
    (select u from (select coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture') as u) x
     where u ~ '^https://' and char_length(u) <= 500)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists geobarkr_on_auth_user_created on auth.users;
create trigger geobarkr_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Starting and joining ----------

-- The Start Game form (ServiceNow record producer). Creates the game and its
-- rounds from the map's locations. Single player starts round 1 straight
-- away; multiplayer adds the creator as a player and opens a lobby; in person
-- the creator is the host screen, not a player.
create or replace function public.create_game(p_type public.game_type, p_map uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_map public.maps;
  v_game public.games;
begin
  -- Active, and public or yours (a private map is only for its owner's games).
  -- Locked so its photos can't be swapped out while the rounds copy them.
  select * into v_map from public.maps
  where id = p_map and active and not blocked and (owner_id is null or is_public or owner_id = v_uid)
  for share;
  if not found then
    raise exception 'That map isn''t available';
  end if;
  if not exists (select 1 from public.locations where map_id = p_map) then
    raise exception 'That map has no locations yet';
  end if;
  if v_map.owner_id is not null and (select count(*) from public.locations where map_id = p_map) <> 5 then
    raise exception 'That map needs all five locations first';
  end if;

  insert into public.games (code, type, status, map_id, map_name, host_id, started_at)
  values (
    public.new_room_code(), p_type,
    case when p_type = 'single_player' then 'in_play' else 'lobby' end::public.game_status,
    p_map, v_map.name, v_uid,
    case when p_type = 'single_player' then now() end
  )
  returning * into v_game;

  -- Rounds follow the locations' round numbers, renumbered 1, 2, 3… so a map
  -- with a gap still plays every location.
  insert into public.rounds (game_id, round_number, location_id, location_name, lat, lng, heading, pitch, photo_path)
  select v_game.id, row_number() over (order by l.round_number), l.id, l.name, l.lat, l.lng, l.heading, l.pitch,
         case when v_map.kind = 'photo' then l.photo_path end
  from public.locations l
  where l.map_id = p_map;

  if p_type <> 'local_multiplayer' then
    insert into public.game_players (game_id, user_id) values (v_game.id, v_uid);
  end if;

  if p_type = 'single_player' then
    update public.rounds set status = 'in_progress', started_at = now()
    where game_id = v_game.id and round_number = 1;
  end if;

  return jsonb_build_object('id', v_game.id, 'code', v_game.code, 'type', v_game.type);
end;
$$;

-- Join with a room code (typed, or from the QR code). Lobby only.
create or replace function public.join_game(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_game public.games;
begin
  select * into v_game from public.games where code = upper(trim(p_code)) for update;
  if not found or v_game.type = 'single_player' then
    raise exception 'No game with that code';
  end if;

  -- Already in it (or hosting it): just go back in.
  if v_game.host_id = v_uid
     or exists (select 1 from public.game_players where game_id = v_game.id and user_id = v_uid) then
    return jsonb_build_object('id', v_game.id, 'type', v_game.type, 'status', v_game.status);
  end if;

  if v_game.status = 'cancelled' then
    raise exception 'That game was cancelled';
  end if;
  if v_game.status <> 'lobby' then
    raise exception 'That game has already started';
  end if;

  insert into public.game_players (game_id, user_id) values (v_game.id, v_uid);
  perform public.notify_game(v_game.id, 'players');
  return jsonb_build_object('id', v_game.id, 'type', v_game.type, 'status', v_game.status);
end;
$$;

-- Host only, from the lobby, with at least two players (startMultiGame).
create or replace function public.start_game(p_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_game public.games;
begin
  select * into v_game from public.games where id = p_game for update;
  if not found or v_game.host_id <> v_uid then
    raise exception 'Only the host can start the game';
  end if;
  if v_game.status <> 'lobby' then
    raise exception 'The game has already started';
  end if;
  if (select count(*) from public.game_players where game_id = p_game) < 2 then
    raise exception 'You need at least two players to start';
  end if;

  update public.games set status = 'in_play', started_at = now() where id = p_game;
  update public.rounds set status = 'in_progress', started_at = now()
  where game_id = p_game and round_number = 1;
  perform public.notify_game(p_game, 'started');
end;
$$;

-- The host calls off a game that hasn't started yet; everyone in the lobby
-- is told live and sent back to the start.
create or replace function public.cancel_game(p_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_game public.games;
begin
  select * into v_game from public.games where id = p_game for update;
  if not found or v_game.host_id <> v_uid then
    raise exception 'Only the host can cancel the game';
  end if;
  if v_game.status <> 'lobby' then
    raise exception 'The game has already started';
  end if;
  update public.games set status = 'cancelled' where id = p_game;
  perform public.notify_game(p_game, 'cancelled');
end;
$$;

-- ---------- Playing a round ----------

-- A round's results are shown: move it to Results and only now add its
-- scores to the players' totals, so nobody can see a total jump before the
-- reveal. Does nothing if the round isn't in progress.
create or replace function public.reveal_round(p_round uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.rounds set status = 'results' where id = p_round and status = 'in_progress';
  if not found then
    return false;
  end if;
  update public.game_players gp
  set total_score = gp.total_score + g.score, total_distance_km = gp.total_distance_km + g.distance_km
  from public.guesses g
  where g.round_id = p_round and g.player_id = gp.id;
  return true;
end;
$$;

-- A player's guess on the current round (createGuess + the score business
-- rule). The distance is worked out here, never trusted from the browser. When
-- the last player guesses, the round moves to Results and totals update.
create or replace function public.submit_guess(p_game uuid, p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_player uuid;
  v_round public.rounds;
  v_distance double precision;
  v_score integer;
  v_time integer;
  v_complete boolean := false;
begin
  select id into v_player from public.game_players where game_id = p_game and user_id = v_uid;
  if v_player is null then
    raise exception 'You''re not in this game';
  end if;

  select r.* into v_round
  from public.rounds r join public.games g on g.id = r.game_id
  where r.game_id = p_game and r.status = 'in_progress' and g.status = 'in_play'
  for update of r;
  if not found then
    raise exception 'This round has finished';
  end if;

  if exists (select 1 from public.guesses where round_id = v_round.id and player_id = v_player) then
    raise exception 'You''ve already guessed this round';
  end if;

  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'That isn''t a place on the map';
  end if;

  v_distance := public.round_distance_km(public.haversine_km(p_lat, p_lng, v_round.lat, v_round.lng));
  v_score := public.score_for_distance(v_distance);
  -- Capped at the integer limit (about 24 days) so a long-abandoned round can still be finished.
  v_time := least(2147483647, greatest(0, floor(extract(epoch from (clock_timestamp() - v_round.started_at)) * 1000)))::integer;

  insert into public.guesses (round_id, player_id, lat, lng, distance_km, score, time_ms)
  values (v_round.id, v_player, p_lat, p_lng, v_distance, v_score, v_time);

  if (select count(*) from public.guesses where round_id = v_round.id)
     >= (select count(*) from public.game_players where game_id = p_game) then
    v_complete := public.reveal_round(v_round.id);
  end if;

  perform public.notify_game(p_game, case when v_complete then 'round_results' else 'guess' end);
  return jsonb_build_object('distance_km', v_distance, 'score', v_score, 'time_ms', v_time, 'round_complete', v_complete);
end;
$$;

-- Host only: end the round now. Anyone who hasn't guessed scores 0 for it.
create or replace function public.end_round(p_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_game public.games;
begin
  select * into v_game from public.games where id = p_game for update;
  if not found or v_game.host_id <> v_uid or v_game.type = 'single_player' then
    raise exception 'Only the host can end the round';
  end if;

  if public.reveal_round((select id from public.rounds where game_id = p_game and status = 'in_progress')) then
    perform public.notify_game(p_game, 'round_results');
  end if;
end;
$$;

-- Host only (in single player, the player): finish the round on Results and
-- start the next, or complete the game after the last (nextRound +
-- checkIfNextRound + completeGame). Returns 'next' or 'complete'.
create or replace function public.next_round(p_game uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_game public.games;
  v_round public.rounds;
begin
  select * into v_game from public.games where id = p_game for update;
  if not found or v_game.host_id <> v_uid then
    raise exception 'Only the host can move to the next round';
  end if;
  if v_game.status <> 'in_play' then
    raise exception 'This game isn''t being played';
  end if;

  select * into v_round from public.rounds
  where game_id = p_game and status in ('in_progress', 'results')
  order by round_number limit 1;
  if found and v_round.status = 'in_progress' then
    raise exception 'Wait for everyone to guess, or end the round';
  end if;

  if found then
    update public.rounds set status = 'complete', ended_at = now() where id = v_round.id;
    update public.rounds set status = 'in_progress', started_at = now()
    where game_id = p_game and round_number = v_round.round_number + 1 and status = 'ready';
    if found then
      perform public.notify_game(p_game, 'next_round');
      return 'next';
    end if;
  end if;

  update public.games set status = 'complete', completed_at = now() where id = p_game;
  update public.rounds set status = 'complete', ended_at = coalesce(ended_at, now())
  where game_id = p_game and status <> 'complete';
  perform public.notify_game(p_game, 'complete');
  return 'complete';
end;
$$;

-- ---------- Reading ----------

-- Everything a game screen needs, for the host or a player. The target is only
-- included when the caller should see it: while a round is being played the
-- Street View screen needs it (single player, every online player, the
-- in-person host) but in-person phones don't get it until Results. Other
-- players' guess positions, distances and scores also wait for Results.
create or replace function public.get_game_state(p_game uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_game public.games;
  v_round public.rounds;
  v_is_host boolean;
  v_show_target boolean;
  v_reveal boolean;
begin
  select * into v_game from public.games where id = p_game;
  if not found or not (public.is_game_member(p_game) or public.is_admin()) then
    raise exception 'Game not found';
  end if;
  v_is_host := v_game.host_id = v_uid;

  select * into v_round from public.rounds
  where game_id = p_game and status in ('in_progress', 'results')
  order by round_number limit 1;

  v_reveal := v_round.status = 'results';
  v_show_target := v_reveal
    or (v_round.status = 'in_progress' and (v_game.type <> 'local_multiplayer' or v_is_host));

  return jsonb_build_object(
    'game', jsonb_build_object(
      'id', v_game.id,
      'code', v_game.code,
      'type', v_game.type,
      'status', v_game.status,
      'map_name', v_game.map_name,
      'created_at', v_game.created_at,
      'host_id', v_game.host_id,
      'host_name', (select display_name from public.profiles where id = v_game.host_id),
      'is_host', v_is_host,
      'round_count', (select count(*) from public.rounds where game_id = p_game)
    ),
    'me', jsonb_build_object(
      'user_id', v_uid,
      'display_name', (select display_name from public.profiles where id = v_uid),
      'avatar_url', (select avatar_url from public.profiles where id = v_uid),
      'is_player', exists (select 1 from public.game_players where game_id = p_game and user_id = v_uid)
    ),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', gp.user_id,
        'name', p.display_name,
        'avatar_url', p.avatar_url,
        'joined_at', gp.joined_at,
        'total_score', gp.total_score,
        'total_distance_km', gp.total_distance_km,
        'is_host', gp.user_id = v_game.host_id
      ) order by gp.joined_at), '[]'::jsonb)
      from public.game_players gp join public.profiles p on p.id = gp.user_id
      where gp.game_id = p_game
    ),
    'round', case when v_round.id is null then null else jsonb_build_object(
      'number', v_round.round_number,
      'status', v_round.status,
      'started_at', v_round.started_at,
      -- A photo round only needs its photo until the reveal; the place waits.
      'target', case
        when not v_show_target then null
        when v_round.photo_path is not null and not v_reveal then jsonb_build_object('photo_path', v_round.photo_path)
        else jsonb_build_object(
          'lat', v_round.lat, 'lng', v_round.lng, 'heading', v_round.heading, 'pitch', v_round.pitch,
          'photo_path', v_round.photo_path)
      end,
      -- The place's name only once the round is over.
      'place', case when v_reveal then v_round.location_name end
    ) end,
    'guesses', (
      select coalesce(jsonb_agg(
        jsonb_build_object('user_id', gp.user_id, 'name', p.display_name, 'time_ms', g.time_ms)
        || case when v_reveal or gp.user_id = v_uid then jsonb_build_object(
             'lat', g.lat, 'lng', g.lng, 'distance_km', g.distance_km, 'score', g.score
           ) else '{}'::jsonb end
        order by g.created_at), '[]'::jsonb)
      from public.guesses g
      join public.game_players gp on gp.id = g.player_id
      join public.profiles p on p.id = gp.user_id
      where g.round_id = v_round.id
    )
  );
end;
$$;

-- Scorecards for the results pages (getUserGameGuesses + getGameSummary).
-- Players sorted by total score, highest first. Only finished rounds.
create or replace function public.get_results(p_game uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_game public.games;
begin
  select * into v_game from public.games where id = p_game;
  if not found or not (public.is_game_member(p_game) or public.is_admin()) then
    raise exception 'Game not found';
  end if;

  return jsonb_build_object(
    'game', jsonb_build_object(
      'id', v_game.id, 'code', v_game.code, 'type', v_game.type, 'status', v_game.status,
      'map_name', v_game.map_name, 'created_at', v_game.created_at, 'is_host', v_game.host_id = v_uid
    ),
    'rounds', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'number', r.round_number, 'lat', r.lat, 'lng', r.lng, 'name', r.location_name, 'photo_path', r.photo_path
      ) order by r.round_number), '[]'::jsonb)
      from public.rounds r
      where r.game_id = p_game and r.status in ('results', 'complete')
    ),
    'players', (
      select coalesce(jsonb_agg(x.player order by x.total_score desc, x.joined_at), '[]'::jsonb)
      from (
        select gp.total_score, gp.joined_at, jsonb_build_object(
          'user_id', gp.user_id,
          'name', p.display_name,
          'avatar_url', p.avatar_url,
          'is_me', gp.user_id = v_uid,
          'total_score', gp.total_score,
          'total_distance_km', gp.total_distance_km,
          'total_time_ms', (select coalesce(sum(g.time_ms), 0) from public.guesses g where g.player_id = gp.id),
          'guesses', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'round', r.round_number,
              'lat', g.lat, 'lng', g.lng,
              'distance_km', g.distance_km, 'score', g.score, 'time_ms', g.time_ms
            ) order by r.round_number), '[]'::jsonb)
            from public.guesses g join public.rounds r on r.id = g.round_id
            where g.player_id = gp.id and r.status in ('results', 'complete')
          )
        ) as player
        from public.game_players gp join public.profiles p on p.id = gp.user_id
        where gp.game_id = p_game
      ) x
    )
  );
end;
$$;

-- My games: everything I've played or hosted, newest first, with the places
-- of finished rounds and my guesses there.
create or replace function public.my_games()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb)
  from (
    select g.id, g.code, g.type, g.status, g.map_name, g.created_at,
           g.host_id = auth.uid() as is_host,
           me.total_score as my_score,
           (select count(*) from public.game_players where game_id = g.id) as player_count,
           case when me.id is not null then
             (select 1 + count(*) from public.game_players o where o.game_id = g.id and o.total_score > me.total_score)
           end as my_rank,
           -- Finished rounds only: each place, and my guess there (for the small maps).
           (select coalesce(jsonb_agg(jsonb_build_object(
              'lat', r.lat, 'lng', r.lng,
              'guess_lat', mg.lat, 'guess_lng', mg.lng
            ) order by r.round_number), '[]'::jsonb)
            from public.rounds r
            left join public.guesses mg on mg.round_id = r.id and mg.player_id = me.id
            where r.game_id = g.id and r.status in ('results', 'complete')) as places
    from public.games g
    left join public.game_players me on me.game_id = g.id and me.user_id = auth.uid()
    where (g.host_id = auth.uid() or me.id is not null) and g.status <> 'cancelled'
    order by g.created_at desc
    limit 200
  ) x;
$$;

-- All-time leaderboard over completed games: p_sort 'total' (all points) or
-- 'best' (best single game).
create or replace function public.leaderboard(p_sort text default 'total', p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.rank), '[]'::jsonb)
  from (
    select row_number() over (
             order by case when p_sort = 'best' then max(gp.total_score) else sum(gp.total_score) end desc, count(*) desc
           ) as rank,
           p.display_name as name,
           p.avatar_url,
           gp.user_id = auth.uid() as is_me,
           count(*) as games,
           sum(gp.total_score) as total_score,
           max(gp.total_score) as best_game,
           round(avg(gp.total_score)) as average_game
    from public.game_players gp
    join public.games g on g.id = gp.game_id and g.status = 'complete'
    join public.profiles p on p.id = gp.user_id
    where auth.uid() is not null
    group by gp.user_id, p.display_name, p.avatar_url
    order by case when p_sort = 'best' then max(gp.total_score) else sum(gp.total_score) end desc, count(*) desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) x;
$$;

-- ---------- Maps players make ----------

-- Maps you can start a game on: active, public or yours, and complete (admin
-- maps need at least one location; players' maps need all five).
create or replace function public.playable_maps()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by lower(x.name), x.id), '[]'::jsonb)
  from (
    select m.id, m.name, m.description, m.kind, m.is_public,
           m.owner_id is not null and m.owner_id = auth.uid() as mine,
           case when m.owner_id is not null then p.display_name end as owner_name,
           c.rounds
    from public.maps m
    left join public.profiles p on p.id = m.owner_id
    cross join lateral (select count(*) as rounds from public.locations l where l.map_id = m.id) c
    where auth.uid() is not null
      and m.active and not m.blocked
      and (m.owner_id is null or m.is_public or m.owner_id = auth.uid())
      and (case when m.owner_id is null then c.rounds >= 1 else c.rounds = 5 end)
  ) x;
$$;

-- Your maps, newest first, for your profile.
create or replace function public.my_maps()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb)
  from (
    select m.id, m.name, m.description, m.kind, m.is_public, m.active, m.blocked, m.created_at,
           (select count(*) from public.locations l where l.map_id = m.id) as rounds,
           (select l.photo_path from public.locations l
            where l.map_id = m.id and l.photo_path is not null order by l.round_number limit 1) as cover_path,
           (select coalesce(jsonb_agg(jsonb_build_object('lat', l.lat, 'lng', l.lng) order by l.round_number), '[]'::jsonb)
            from public.locations l where l.map_id = m.id) as places,
           (select count(*) from public.games g where g.map_id = m.id and g.status = 'complete') as plays
    from public.maps m
    where m.owner_id = auth.uid()
  ) x;
$$;

-- One of your maps with its locations, for the map editor.
create or replace function public.get_my_map(p_map uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_map public.maps;
begin
  select * into v_map from public.maps where id = p_map and owner_id = v_uid;
  if not found then
    raise exception 'Map not found';
  end if;
  return jsonb_build_object(
    'id', v_map.id, 'name', v_map.name, 'description', v_map.description, 'kind', v_map.kind,
    'is_public', v_map.is_public, 'active', v_map.active, 'blocked', v_map.blocked, 'created_at', v_map.created_at,
    'plays', (select count(*) from public.games g where g.map_id = v_map.id and g.status = 'complete'),
    'locations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'round_number', l.round_number, 'name', l.name, 'lat', l.lat, 'lng', l.lng,
        'heading', l.heading, 'pitch', l.pitch, 'photo_path', l.photo_path
      ) order by l.round_number), '[]'::jsonb)
      from public.locations l where l.map_id = v_map.id
    )
  );
end;
$$;

-- Checks shared by creating and editing a map. Returns the trimmed name.
create or replace function public.check_map_details(p_name text, p_description text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Give the map a name (up to 80 characters)';
  end if;
  if char_length(trim(coalesce(p_description, ''))) > 140 then
    raise exception 'Keep the description to 140 characters';
  end if;
  return trim(p_name);
end;
$$;

-- A new map of yours (no locations yet). Up to 30 each.
create or replace function public.create_my_map(p_name text, p_description text, p_kind public.map_kind, p_public boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_name text := public.check_map_details(p_name, p_description);
  v_id uuid;
begin
  if p_kind is null then
    raise exception 'Choose Street View or photos';
  end if;
  if (select count(*) from public.maps where owner_id = v_uid) >= 30 then
    raise exception 'You can have up to 30 maps. Delete one to make another';
  end if;
  insert into public.maps (name, description, kind, is_public, active, owner_id)
  values (v_name, trim(coalesce(p_description, '')), p_kind, coalesce(p_public, true), true, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

-- Rename, describe, make public or private, switch on or off. The kind stays.
create or replace function public.update_my_map(p_map uuid, p_name text, p_description text, p_public boolean, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_name text := public.check_map_details(p_name, p_description);
begin
  update public.maps
  set name = v_name, description = trim(coalesce(p_description, '')),
      is_public = coalesce(p_public, is_public), active = coalesce(p_active, active)
  where id = p_map and owner_id = v_uid;
  if not found then
    raise exception 'Map not found';
  end if;
end;
$$;

-- A photo nobody needs any more: not on a location, and not in any game
-- (games keep their rounds' photos). The caller then deletes the file.
create or replace function public.photo_unused(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_path is not null
     and not exists (select 1 from public.locations where photo_path = p_path)
     and not exists (select 1 from public.rounds where photo_path = p_path);
$$;

-- Set round p_round (1 to 5) of your map. Photo maps need a photo you
-- uploaded; Street View maps never have one. Returns the photo it replaced,
-- if that can now be deleted: { "removed_photo": path | null }.
create or replace function public.save_my_location(
  p_map uuid, p_round integer, p_name text,
  p_lat double precision, p_lng double precision,
  p_heading double precision, p_pitch double precision, p_photo_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_map public.maps;
  v_old text;
begin
  select * into v_map from public.maps where id = p_map and owner_id = v_uid for update;
  if not found then
    raise exception 'Map not found';
  end if;
  if p_round is null or p_round not between 1 and 5 then
    raise exception 'Maps have five rounds';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Give the place a name (up to 80 characters)';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'That isn''t a place on the map';
  end if;
  if v_map.kind = 'photo' then
    if p_photo_path is null or p_photo_path !~ ('^' || v_uid::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|webp)$') then
      raise exception 'Add a photo for this round';
    end if;
  elsif p_photo_path is not null then
    raise exception 'Street View maps don''t have photos';
  end if;

  select photo_path into v_old from public.locations where map_id = p_map and round_number = p_round;
  insert into public.locations (map_id, round_number, name, lat, lng, heading, pitch, photo_path)
  values (
    p_map, p_round, trim(p_name), p_lat, p_lng,
    ((coalesce(p_heading, 0)::numeric % 360 + 360) % 360)::double precision,
    greatest(-90, least(90, coalesce(p_pitch, 0))),
    p_photo_path
  )
  on conflict (map_id, round_number) do update
  set name = excluded.name, lat = excluded.lat, lng = excluded.lng, heading = excluded.heading,
      pitch = excluded.pitch, photo_path = excluded.photo_path;

  return jsonb_build_object('removed_photo',
    case when v_old is distinct from p_photo_path and public.photo_unused(v_old) then v_old end);
end;
$$;

-- Clear a round of your map. Returns { "removed_photo": path | null }.
create or replace function public.delete_my_location(p_map uuid, p_round integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_old text;
begin
  perform 1 from public.maps where id = p_map and owner_id = v_uid for update;
  if not found then
    raise exception 'Map not found';
  end if;
  delete from public.locations where map_id = p_map and round_number = p_round returning photo_path into v_old;
  return jsonb_build_object('removed_photo', case when public.photo_unused(v_old) then v_old end);
end;
$$;

-- Delete one of your maps. Games already played on it keep their rounds.
-- Returns { "removed_photos": [paths that can now be deleted] }.
create or replace function public.delete_my_map(p_map uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_paths text[];
begin
  perform 1 from public.maps where id = p_map and owner_id = v_uid for update;
  if not found then
    raise exception 'Map not found';
  end if;
  select coalesce(array_agg(photo_path), '{}') into v_paths
  from public.locations where map_id = p_map and photo_path is not null;
  delete from public.maps where id = p_map;
  return jsonb_build_object('removed_photos', (
    select coalesce(jsonb_agg(p), '[]'::jsonb) from unnest(v_paths) p where public.photo_unused(p)
  ));
end;
$$;

-- Storage: a player may upload photos into their own folder of map-photos,
-- up to 150 at a time (the storage policies in 003 call this). Photos kept
-- only because finished games show them don't count.
create or replace function public.can_upload_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and p_name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|webp)$')
     and (select count(*) from storage.objects o
          where o.bucket_id = 'map-photos' and o.name like auth.uid()::text || '/%'
            and not exists (select 1 from public.rounds r where r.photo_path = o.name)) < 150;
$$;

-- ---------- Profile ----------

-- Your numbers over finished games, for your profile.
create or replace function public.my_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select gp.id, gp.total_score, g.type,
           (select count(*) from public.game_players o where o.game_id = gp.game_id) as players,
           (select 1 + count(*) from public.game_players o where o.game_id = gp.game_id and o.total_score > gp.total_score) as place
    from public.game_players gp
    join public.games g on g.id = gp.game_id and g.status = 'complete'
    where gp.user_id = auth.uid()
  ),
  my_guesses as (
    select g.distance_km, g.score, g.time_ms, r.location_name
    from public.guesses g
    join mine m on m.id = g.player_id
    join public.rounds r on r.id = g.round_id
  ),
  totals as (
    select gp.user_id, sum(gp.total_score) as total
    from public.game_players gp join public.games g on g.id = gp.game_id and g.status = 'complete'
    group by gp.user_id
  )
  select jsonb_build_object(
    'games', (select count(*) from mine),
    'solo_games', (select count(*) from mine where type = 'single_player'),
    'group_games', (select count(*) from mine where type <> 'single_player'),
    'wins', (select count(*) from mine where players > 1 and place = 1),
    'total_score', (select coalesce(sum(total_score), 0) from mine),
    'best_game', (select coalesce(max(total_score), 0) from mine),
    'average_game', (select round(avg(total_score)) from mine),
    'rounds', (select count(*) from my_guesses),
    'perfect_rounds', (select count(*) from my_guesses where score = 5000),
    'average_km', (select avg(distance_km) from my_guesses),
    'closest_km', (select min(distance_km) from my_guesses),
    'closest_place', (select location_name from my_guesses order by distance_km, time_ms limit 1),
    'average_time_ms', (select round(avg(time_ms)) from my_guesses),
    'fastest_ms', (select min(time_ms) from my_guesses),
    'rank', case when exists (select 1 from mine) then
      1 + (select count(*) from totals where total > (select sum(total_score) from mine)) end,
    'players', (select count(*) from totals),
    'maps_made', (select count(*) from public.maps where owner_id = auth.uid())
  )
  where auth.uid() is not null;
$$;
