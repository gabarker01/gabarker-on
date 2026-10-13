-- GeoBarkr: everything in one file, for pasting into the Supabase SQL Editor.
-- Generated from migrations/001-003 and seed.sql (keep them in step; a test checks).
-- Safe to run again.

-- GeoBarkr 001: tables.
-- For GeoBarkr's own Supabase project (not TapMap's). Safe to re-run.
--
-- ServiceNow → here:
--   sys_user + x_geobarkr.user role   → profiles (role player | admin)
--   x_1119993_geobarkr_map            → maps
--   x_1119993_geobarkr_location       → locations
--   x_1119993_geobarkr_game           → games (number → 6-character room code)
--   x_1119993_geobarkr_game_player    → game_players
--   x_1119993_geobarkr_round          → rounds (with a copy of the location)
--   x_1119993_geobarkr_guess          → guesses

-- ---------- Types ----------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role' and typnamespace = 'public'::regnamespace) then
    create type public.app_role as enum ('player', 'admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'game_type' and typnamespace = 'public'::regnamespace) then
    create type public.game_type as enum ('single_player', 'multiplayer', 'local_multiplayer');
  end if;
  -- Lobby (1), In Play (2), Complete (3), Cancelled (4) in ServiceNow.
  if not exists (select 1 from pg_type where typname = 'game_status' and typnamespace = 'public'::regnamespace) then
    create type public.game_status as enum ('lobby', 'in_play', 'complete', 'cancelled');
  end if;
  -- Ready (1), In Progress (2), Results (21), Complete (3) in ServiceNow.
  if not exists (select 1 from pg_type where typname = 'round_status' and typnamespace = 'public'::regnamespace) then
    create type public.round_status as enum ('ready', 'in_progress', 'results', 'complete');
  end if;
end
$$;

-- ---------- Tables ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  role public.app_role not null default 'player',
  created_at timestamptz not null default now()
);

-- Profile photo from Google sign-in (shown on map pins); initials otherwise.
alter table public.profiles
  add column if not exists avatar_url text check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 500));

create table if not exists public.maps (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  round_number smallint not null check (round_number between 1 and 5),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  heading double precision not null default 0 check (heading >= 0 and heading < 360),
  pitch double precision not null default 0 check (pitch between -90 and 90),
  created_at timestamptz not null default now(),
  -- One location per round of a map (ServiceNow allowed duplicates, which broke the game).
  unique (map_id, round_number)
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  type public.game_type not null,
  status public.game_status not null default 'lobby',
  map_id uuid references public.maps (id) on delete set null,
  map_name text not null,
  -- The game's owner (ServiceNow: sys_created_by). In person, the host screen.
  host_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists games_host_idx on public.games (host_id);

create table if not exists public.game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  total_score integer not null default 0,
  total_distance_km double precision not null default 0,
  unique (game_id, user_id)
);

create index if not exists game_players_user_idx on public.game_players (user_id);

-- A round keeps its own copy of the location, so editing or deleting a
-- location later doesn't change games already played.
create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  round_number smallint not null check (round_number between 1 and 5),
  location_id uuid references public.locations (id) on delete set null,
  location_name text not null,
  lat double precision not null,
  lng double precision not null,
  heading double precision not null default 0,
  pitch double precision not null default 0,
  status public.round_status not null default 'ready',
  started_at timestamptz,
  ended_at timestamptz,
  unique (game_id, round_number)
);

create table if not exists public.guesses (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  player_id uuid not null references public.game_players (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  distance_km double precision not null,
  score integer not null check (score between 0 and 5000),
  -- How long the guess took from the start of the round (ServiceNow: guess_time).
  time_ms integer not null check (time_ms >= 0),
  created_at timestamptz not null default now(),
  unique (round_id, player_id)
);

create index if not exists guesses_player_idx on public.guesses (player_id);

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
  select * into v_map from public.maps where id = p_map and active;
  if not found then
    raise exception 'That map isn''t available';
  end if;
  if not exists (select 1 from public.locations where map_id = p_map) then
    raise exception 'That map has no locations yet';
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
  insert into public.rounds (game_id, round_number, location_id, location_name, lat, lng, heading, pitch)
  select v_game.id, row_number() over (order by l.round_number), l.id, l.name, l.lat, l.lng, l.heading, l.pitch
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
      'target', case when v_show_target then jsonb_build_object(
        'lat', v_round.lat, 'lng', v_round.lng, 'heading', v_round.heading, 'pitch', v_round.pitch
      ) end,
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
        'number', r.round_number, 'lat', r.lat, 'lng', r.lng, 'name', r.location_name
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

-- GeoBarkr 003: who can see and change what (row-level security). Safe to re-run.
--
-- Roles (ServiceNow x_geobarkr.user → player, ServiceNow admin → admin):
--   signed out   nothing at all
--   player       read own profile and rename themselves; read active maps;
--                read games they host or play in, and those games' players;
--                read their own guesses; everything else through the game
--                functions in 002
--   admin        read everything; create, edit and delete maps and locations
--
-- Nobody, admin included, writes games, players, rounds or guesses directly:
-- only the game functions do.

alter table public.profiles enable row level security;
alter table public.maps enable row level security;
alter table public.locations enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.rounds enable row level security;
alter table public.guesses enable row level security;

-- ---------- Table privileges ----------

revoke all on public.profiles, public.maps, public.locations, public.games,
  public.game_players, public.rounds, public.guesses from anon, authenticated;

grant select on public.profiles, public.maps, public.locations, public.games,
  public.game_players, public.rounds, public.guesses to authenticated;
-- Only the display name can be changed, so nobody can make themselves admin.
grant update (display_name) on public.profiles to authenticated;
grant insert, update, delete on public.maps, public.locations to authenticated;

-- ---------- Policies ----------

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "rename yourself" on public.profiles;
create policy "rename yourself" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "players see active maps" on public.maps;
create policy "players see active maps" on public.maps
  for select to authenticated
  using (active or (select public.is_admin()));

drop policy if exists "admins manage maps" on public.maps;
create policy "admins manage maps" on public.maps
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Locations are the answers: admins only.
drop policy if exists "admins manage locations" on public.locations;
create policy "admins manage locations" on public.locations
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "members see their games" on public.games;
create policy "members see their games" on public.games
  for select to authenticated
  using (public.is_game_member(id) or (select public.is_admin()));

drop policy if exists "members see their game's players" on public.game_players;
create policy "members see their game's players" on public.game_players
  for select to authenticated
  using (public.is_game_member(game_id) or (select public.is_admin()));

-- Rounds hold the target location: read through get_game_state only.
drop policy if exists "admins see rounds" on public.rounds;
create policy "admins see rounds" on public.rounds
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "see own guesses" on public.guesses;
create policy "see own guesses" on public.guesses
  for select to authenticated
  using (
    (select public.is_admin())
    or player_id in (select id from public.game_players where user_id = (select auth.uid()))
  );

-- ---------- Function privileges ----------

revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_admin(),
  public.is_game_member(uuid),
  public.can_listen(text),
  public.haversine_km(double precision, double precision, double precision, double precision),
  public.round_distance_km(double precision),
  public.score_for_distance(double precision),
  public.create_game(public.game_type, uuid),
  public.join_game(text),
  public.start_game(uuid),
  public.cancel_game(uuid),
  public.submit_guess(uuid, double precision, double precision),
  public.end_round(uuid),
  public.next_round(uuid),
  public.get_game_state(uuid),
  public.get_results(uuid),
  public.my_games(),
  public.leaderboard(text, integer)
to authenticated;

-- ---------- Realtime ----------

-- Each game broadcasts on the private channel "game:<id>"; only its host and
-- players (and admins) can listen.
drop policy if exists "game members receive game events" on realtime.messages;
create policy "game members receive game events" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.can_listen((select realtime.topic())));

-- GeoBarkr seed: the original ServiceNow map "GeoBarkr Demo" (MAP0001002) and
-- its five locations, exactly as exported. Safe to re-run.

insert into public.maps (id, name, active)
values ('eb30f2ba-939a-f610-0fa1-7bfdfaba1097', 'GeoBarkr Demo', true)
on conflict (id) do nothing;

insert into public.locations (id, map_id, name, round_number, lat, lng, heading, pitch) values
  ('6a6f263a-939a-f610-0fa1-7bfdfaba106f', 'eb30f2ba-939a-f610-0fa1-7bfdfaba1097', '4 Medley Road', 1, 51.54713683719802, -0.1947690014365771, 120, 0),
  ('814a841f-9396-ba10-0fa1-7bfdfaba1064', 'eb30f2ba-939a-f610-0fa1-7bfdfaba1097', 'Calitii', 2, 51.5160261988762, -0.12549442205816058, 200, 0),
  ('7da0acdb-935a-ba10-0fa1-7bfdfaba10a9', 'eb30f2ba-939a-f610-0fa1-7bfdfaba1097', 'Eiffel Tower', 3, 48.859, 2.296, 250, 0),
  ('3a71ec5f-935a-ba10-0fa1-7bfdfaba104b', 'eb30f2ba-939a-f610-0fa1-7bfdfaba1097', 'Sydney harbour', 4, -33.8524678, 151.2105238, 0, 0),
  ('69c2ac13-939a-ba10-0fa1-7bfdfaba100b', 'eb30f2ba-939a-f610-0fa1-7bfdfaba1097', 'CopaCobana', 5, -22.9682017, -43.1797941, 244.26, 0)
on conflict (id) do nothing;

-- A second map with five far-apart, well-covered Street View spots.
insert into public.maps (id, name, active)
values ('6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01', 'World tour', true)
on conflict (id) do nothing;

insert into public.locations (id, map_id, name, round_number, lat, lng, heading, pitch) values
  ('6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a11', '6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01', 'Times Square, New York', 1, 40.7580, -73.9855, 30, 0),
  ('6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a12', '6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01', 'Shibuya, Tokyo', 2, 35.6595, 139.7005, 60, 0),
  ('6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a13', '6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01', 'V&A Waterfront, Cape Town', 3, -33.9036, 18.4207, 200, 0),
  ('6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a14', '6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01', 'Laugavegur, Reykjavík', 4, 64.1455, -21.9300, 90, 0),
  ('6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a15', '6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01', 'Avenida 9 de Julio, Buenos Aires', 5, -34.6037, -58.3816, 0, 0)
on conflict (id) do nothing;

