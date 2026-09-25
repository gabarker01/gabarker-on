-- TapMap database: profiles, follow requests and daily game results.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run: it drops and recreates only TapMap's own objects.

-- ---------- Tables ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index if not exists follows_followee_idx on public.follows (followee_id);

-- Follows start as requests and count once the other player accepts.
-- (Follows made before requests existed are kept as accepted.)
alter table public.follows
  add column if not exists status text not null default 'accepted' check (status in ('pending', 'accepted'));
alter table public.follows alter column status set default 'pending';

-- Profile photo (a public URL in the "avatars" storage bucket); initials otherwise.
alter table public.profiles
  add column if not exists avatar_url text check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 500));

-- The player's time zone (e.g. "Europe/London"), set by the game, so streaks
-- can use the player's own date. Null means UTC.
alter table public.profiles
  add column if not exists time_zone text check (time_zone is null or time_zone ~ '^[A-Za-z0-9_+/-]{1,64}$');

-- Today's date in a time zone; UTC if the zone is missing or unknown.
create or replace function public.local_today(tz text)
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  return (now() at time zone coalesce(tz, 'UTC'))::date;
exception when others then
  return (now() at time zone 'UTC')::date;
end;
$$;

-- Accepting a follow request makes it mutual: the other player follows back.
-- (security definer: players can't otherwise create an accepted follow.)
create or replace function public.follow_back()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    insert into public.follows (follower_id, followee_id, status)
    values (new.followee_id, new.follower_id, 'accepted')
    on conflict (follower_id, followee_id) do update
      set status = 'accepted'
      where public.follows.status <> 'accepted';
  end if;
  return new;
end;
$$;

drop trigger if exists follows_mutual on public.follows;
create trigger follows_mutual
  after insert or update of status on public.follows
  for each row execute function public.follow_back();

-- Make any follows accepted before this existed mutual too.
insert into public.follows (follower_id, followee_id, status)
select followee_id, follower_id, 'accepted' from public.follows where status = 'accepted'
on conflict (follower_id, followee_id) do update set status = 'accepted' where public.follows.status <> 'accepted';

-- One row per player per daily game. Rows can't be edited or deleted by
-- players, so a day's result can't be replayed or rewritten.
create table if not exists public.games (
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_date date not null,
  game_number integer not null check (game_number > 0),
  -- [{ "score": 0-100, "tier": "🟩", "km": 412.3, "multiplier": 1.5, "guess": { "lat": .., "lng": .. } }, ...]
  rounds jsonb not null check (jsonb_typeof(rounds) = 'array' and jsonb_array_length(rounds) = 5),
  total integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, game_date)
);

create index if not exists games_date_idx on public.games (game_date);

-- The TapMap number always matches the game date: No. 1 is 2026-09-24. The
-- date is the player's own local date (a new game starts at their midnight),
-- not the UTC date. (NOT VALID: checks every new result without re-checking
-- old rows.)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'games_number_matches_date') then
    alter table public.games add constraint games_number_matches_date
      check (game_number = (game_date - date '2026-09-24') + 1) not valid;
  end if;
end $$;

-- The total must be what the rounds add up to: each round's score (0 to 100)
-- times its multiplier, rounded, so at most 1,000.
create or replace function public.game_total_ok(rounds jsonb, total integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  r jsonb;
  score numeric;
  multiplier numeric;
  weighted numeric := 0;
begin
  if jsonb_typeof(rounds) is distinct from 'array' or total is null then
    return false;
  end if;
  for r in select * from jsonb_array_elements(rounds) loop
    if jsonb_typeof(r -> 'score') is distinct from 'number' or jsonb_typeof(r -> 'multiplier') is distinct from 'number' then
      return false;
    end if;
    score := (r ->> 'score')::numeric;
    multiplier := (r ->> 'multiplier')::numeric;
    if score <> trunc(score) or score < 0 or score > 100
       or multiplier not in (1, 1.5, 2, 2.5, 3) then
      return false;
    end if;
    weighted := weighted + score * multiplier;
  end loop;
  return total = round(weighted) and total between 0 and 1000;
end;
$$;

-- Replaces the old fixed "total between 0 and 1000" check.
alter table public.games drop constraint if exists games_total_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'games_total_matches_rounds') then
    alter table public.games add constraint games_total_matches_rounds
      check (public.game_total_ok(rounds, total)) not valid;
  end if;
end $$;

-- ---------- Players without an account ----------

-- Daily games played without signing in: they count towards the overall
-- daily stats (daily_summary) but never towards leaderboards, friends'
-- results or profile stats. device_id is a random id kept on the player's
-- device (no personal details). Players can add rows but not read them.
create table if not exists public.anonymous_games (
  device_id uuid not null,
  game_date date not null,
  game_number integer not null check (game_number > 0),
  rounds jsonb not null check (jsonb_typeof(rounds) = 'array' and jsonb_array_length(rounds) = 5 and pg_column_size(rounds) < 8000),
  total integer not null,
  created_at timestamptz not null default now(),
  primary key (device_id, game_date),
  constraint anonymous_games_number_matches_date check (game_number = (game_date - date '2026-09-24') + 1),
  constraint anonymous_games_total_matches_rounds check (public.game_total_ok(rounds, total))
);

create index if not exists anonymous_games_date_idx on public.anonymous_games (game_date);

-- A signed-in result also records the device it was played on, so a game
-- played signed out and saved to an account afterwards is only counted once.
alter table public.games add column if not exists device_id uuid;

-- ---------- New users get a profile ----------

-- Username: the one chosen at sign-up if valid and free, otherwise one made
-- from their name or email, made unique with a number if needed.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  n integer := 0;
begin
  candidate := lower(new.raw_user_meta_data ->> 'username');
  if candidate ~ '^[a-z0-9_]{3,20}$' and not exists (select 1 from public.profiles where username = candidate) then
    insert into public.profiles (id, username, display_name)
    values (new.id, candidate, left(coalesce(new.raw_user_meta_data ->> 'display_name', candidate), 40));
    return new;
  end if;

  base := lower(regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'player'),
    '[^a-zA-Z0-9_]+', '', 'g'));
  base := left(base, 14);
  if char_length(base) < 3 then
    base := 'player';
  end if;
  candidate := base;
  while exists (select 1 from public.profiles where username = candidate) loop
    n := n + 1;
    candidate := base || (floor(random() * 9000) + 1000)::int;
    if n > 20 then
      candidate := base || replace(left(new.id::text, 6), '-', '');
      exit;
    end if;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    candidate,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', candidate), 40)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Stats ----------

-- Played, best, average and streaks per player, worked out from games so they
-- never drift. Only your own row and those of players who accepted your
-- follow request are visible. A streak is a run of consecutive game dates
-- (each player's local date). The current streak counts only if its last game
-- was today or yesterday in that player's time zone, as in the game itself.
drop view if exists public.profile_stats;
create view public.profile_stats
with (security_invoker = true)
as
with ordered as (
  select
    user_id,
    game_date,
    game_date - (row_number() over (partition by user_id order by game_date))::integer as run_key
  from public.games
),
runs as (
  select user_id, count(*)::integer as length, max(game_date) as last_date
  from ordered
  group by user_id, run_key
)
select
  p.id as user_id,
  p.username,
  p.display_name,
  count(g.user_id)::integer as played,
  coalesce(max(g.total), 0) as best,
  coalesce(round(avg(g.total))::integer, 0) as average,
  coalesce((select max(r.length) from runs r where r.user_id = p.id), 0) as max_streak,
  coalesce((
    select r.length from runs r
    where r.user_id = p.id and r.last_date >= public.local_today(p.time_zone) - 1
    order by r.last_date desc
    limit 1
  ), 0) as current_streak
from public.profiles p
left join public.games g on g.user_id = p.id
where p.id = (select auth.uid())
  or exists (
    select 1 from public.follows f
    where f.follower_id = (select auth.uid()) and f.followee_id = p.id and f.status = 'accepted'
  )
group by p.id;

-- One row per daily game (date and TapMap number): how many played (with and
-- without an account), the average and the best. For the dashboard: it
-- includes games played without an account, which the app can't read.
drop view if exists public.daily_summary;
create view public.daily_summary
with (security_invoker = true)
as
with all_games as (
  select game_date, game_number, total, true as signed_in
  from public.games
  union all
  select a.game_date, a.game_number, a.total, false
  from public.anonymous_games a
  -- (not if the same game was then saved to an account)
  where not exists (
    select 1 from public.games g where g.device_id = a.device_id and g.game_date = a.game_date
  )
)
select
  game_date,
  game_number,
  count(*)::integer as players,
  count(*) filter (where signed_in)::integer as signed_in_players,
  count(*) filter (where not signed_in)::integer as players_without_account,
  round(avg(total))::integer as average,
  max(total) as best
from all_games
group by game_date, game_number;

-- Weekly league: points per player for each Monday-to-Sunday week (by game
-- date), ranked. security_invoker, so the games table's row-level security
-- applies: you only see yourself and players who accepted your follow, and
-- the ranking is among those.
drop view if exists public.weekly_league;
create view public.weekly_league
with (security_invoker = true)
as
select
  w.week_start,
  w.user_id,
  p.username,
  p.display_name,
  p.avatar_url,
  w.played,
  w.points,
  w.best,
  rank() over (partition by w.week_start order by w.points desc)::integer as rank
from (
  select
    g.game_date - (extract(isodow from g.game_date)::integer - 1) as week_start,
    g.user_id,
    count(*)::integer as played,
    sum(g.total)::integer as points,
    max(g.total) as best
  from public.games g
  group by 1, 2
) w
join public.profiles p on p.id = w.user_id;

-- ---------- Challenges ----------

-- A challenge: five places and the sender's result, shared as
-- https://gabarker.com/tapmap/challenge/{id}. Anyone can create one (you don't
-- need an account) and anyone with the link can read it.
create or replace function public.new_challenge_id()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 10 characters from an alphabet without look-alikes (no 0/o, 1/l).
  select string_agg(substr('abcdefghijkmnpqrstuvwxyz23456789', (get_byte(b, i) % 32) + 1, 1), '' order by i)
  from (select uuid_send(gen_random_uuid()) as b) as random_bytes, generate_series(0, 9) as i;
$$;

create table if not exists public.challenges (
  id text primary key default public.new_challenge_id() check (id ~ '^[a-z0-9]{6,16}$'),
  created_by uuid references public.profiles (id) on delete set null,
  by_name text check (by_name is null or char_length(by_name) between 1 and 40),
  -- daily: a daily game (game_number); practice / photo: five practice places.
  kind text not null check (kind in ('daily', 'practice', 'photo')),
  game_number integer check (game_number is null or game_number > 0),
  -- [{ "name", "lat", "lng", "difficulty", "notes", "photo" }, ...] in round order
  places jsonb not null check (jsonb_typeof(places) = 'array' and jsonb_array_length(places) = 5 and pg_column_size(places) < 8000),
  -- The sender's rounds: [{ "score", "km", "multiplier", "tier", "guess": { "lat", "lng" } }, ...]
  rounds jsonb not null check (jsonb_typeof(rounds) = 'array' and jsonb_array_length(rounds) = 5 and pg_column_size(rounds) < 8000),
  total integer not null,
  created_at timestamptz not null default now(),
  constraint challenges_total_matches_rounds check (public.game_total_ok(rounds, total))
);

create index if not exists challenges_created_by_idx on public.challenges (created_by, created_at desc);

-- A challenge sent to a particular player (from their profile). It shows in
-- their Challenges list until they play it.
alter table public.challenges
  add column if not exists challenged_user uuid references public.profiles (id) on delete set null;
create index if not exists challenges_challenged_user_idx on public.challenges (challenged_user, created_at desc);

-- One result per player per challenge (signed-in players; others keep theirs
-- on their device).
create table if not exists public.challenge_results (
  challenge_id text not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rounds jsonb not null check (jsonb_typeof(rounds) = 'array' and jsonb_array_length(rounds) = 5 and pg_column_size(rounds) < 8000),
  total integer not null,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id),
  constraint challenge_results_total_matches_rounds check (public.game_total_ok(rounds, total))
);

create index if not exists challenge_results_user_idx on public.challenge_results (user_id, created_at desc);

-- Challenge results from players without an account: counted (see
-- anonymous_challenge_players), never listed. Add-only, like anonymous_games.
create table if not exists public.anonymous_challenge_results (
  challenge_id text not null references public.challenges (id) on delete cascade,
  device_id uuid not null,
  rounds jsonb not null check (jsonb_typeof(rounds) = 'array' and jsonb_array_length(rounds) = 5 and pg_column_size(rounds) < 8000),
  total integer not null,
  created_at timestamptz not null default now(),
  primary key (challenge_id, device_id),
  constraint anonymous_challenge_results_total_matches_rounds check (public.game_total_ok(rounds, total))
);

alter table public.challenge_results add column if not exists device_id uuid;

-- How many played a challenge without an account (and haven't since saved the
-- result to one), for the challenge page.
create or replace function public.anonymous_challenge_players(cid text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.anonymous_challenge_results a
  where a.challenge_id = cid
    and not exists (
      select 1 from public.challenge_results r where r.challenge_id = cid and r.device_id = a.device_id
    );
$$;

-- Who can see a challenge's results: whoever sent it and everyone who has
-- played it. (security definer, so the check can read results the policy
-- itself would hide.)
create or replace function public.can_see_challenge_results(cid text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.challenges c where c.id = cid and c.created_by = (select auth.uid()))
    or exists (select 1 from public.challenge_results r where r.challenge_id = cid and r.user_id = (select auth.uid()));
$$;

-- ---------- Row-level security ----------

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.games enable row level security;

-- Profiles are public (so people can be found by username). Follows are
-- visible to the two players involved. Results and stats are visible to the
-- player and to followers they have accepted.
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles
  for select to anon, authenticated using (true);

drop policy if exists "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "follows are public" on public.follows;
-- Accepted follows are visible to signed-in players (who follows whom, on
-- profiles); requests still pending only to the two players involved.
drop policy if exists "see your follows" on public.follows;
create policy "see your follows" on public.follows
  for select to authenticated
  using ((select auth.uid()) in (follower_id, followee_id) or status = 'accepted');

drop policy if exists "follow as yourself" on public.follows;
create policy "follow as yourself" on public.follows
  for insert to authenticated
  with check ((select auth.uid()) = follower_id and status = 'pending');

drop policy if exists "accept requests" on public.follows;
create policy "accept requests" on public.follows
  for update to authenticated
  using ((select auth.uid()) = followee_id)
  with check ((select auth.uid()) = followee_id and status = 'accepted');

-- Unfollow, cancel a request, decline a request or remove a follower.
drop policy if exists "unfollow as yourself" on public.follows;
drop policy if exists "end a follow" on public.follows;
create policy "end a follow" on public.follows
  for delete to authenticated
  using ((select auth.uid()) in (follower_id, followee_id));

drop policy if exists "games are public" on public.games;
drop policy if exists "see own and followed games" on public.games;
create policy "see own and followed games" on public.games
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.follows f
      where f.follower_id = (select auth.uid()) and f.followee_id = games.user_id and f.status = 'accepted'
    )
  );

-- Only your own result, and only for (roughly) today's game.
drop policy if exists "save own game" on public.games;
create policy "save own game" on public.games
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    -- Game dates are the player's local day (UTC-12 to UTC+14), so accept
    -- anything from two days before to one day after today's UTC date.
    and game_date between (now() at time zone 'utc')::date - 2 and (now() at time zone 'utc')::date + 1
  );

alter table public.challenges enable row level security;
alter table public.challenge_results enable row level security;

-- Challenges are public by link. Anyone can create one; signed in, it's
-- recorded as yours (or anonymous), never as someone else's.
drop policy if exists "challenges are public" on public.challenges;
create policy "challenges are public" on public.challenges
  for select to anon, authenticated using (true);

drop policy if exists "create a challenge" on public.challenges;
create policy "create a challenge" on public.challenges
  for insert to anon, authenticated
  with check (
    (created_by is null and challenged_user is null)
    or created_by = (select auth.uid())
  );

-- Results are as public as the challenge link itself: anyone playing it sees
-- the other players' pins and scores.
drop policy if exists "see challenge results" on public.challenge_results;
create policy "see challenge results" on public.challenge_results
  for select to anon, authenticated
  using (true);

drop policy if exists "save own challenge result" on public.challenge_results;
create policy "save own challenge result" on public.challenge_results
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

alter table public.anonymous_games enable row level security;
alter table public.anonymous_challenge_results enable row level security;

-- Anyone can add a game or challenge result without an account (same checks
-- as signed-in games), but nobody can read them back through the app.
drop policy if exists "save a game without an account" on public.anonymous_games;
create policy "save a game without an account" on public.anonymous_games
  for insert to anon, authenticated
  with check (game_date between (now() at time zone 'utc')::date - 2 and (now() at time zone 'utc')::date + 1);

drop policy if exists "save a challenge result without an account" on public.anonymous_challenge_results;
create policy "save a challenge result without an account" on public.anonymous_challenge_results
  for insert to anon, authenticated
  with check (true);

-- ---------- Privileges ----------

grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon, authenticated;
revoke select on public.follows, public.games, public.profile_stats, public.weekly_league from anon;
grant select on public.follows, public.games, public.profile_stats, public.weekly_league to authenticated;
-- daily_summary includes games without an account, so it's for the dashboard only.
revoke select on public.daily_summary from anon, authenticated;
grant insert on public.anonymous_games, public.anonymous_challenge_results to anon, authenticated;
revoke select, update, delete on public.anonymous_games, public.anonymous_challenge_results from anon, authenticated;
grant execute on function public.anonymous_challenge_players(text) to anon, authenticated;
grant update (username, display_name, avatar_url, time_zone) on public.profiles to authenticated;
grant insert, delete on public.follows to authenticated;
grant update (status) on public.follows to authenticated;
grant insert on public.games to authenticated;
grant select, insert on public.challenges to anon, authenticated;
revoke insert on public.challenge_results from anon;
grant select on public.challenge_results to anon, authenticated;
grant insert on public.challenge_results to authenticated;
revoke execute on function public.can_see_challenge_results(text) from anon;
grant execute on function public.can_see_challenge_results(text) to authenticated;

-- ---------- Profile photos (Supabase Storage) ----------

-- Public bucket: anyone can view photos; each player may only write inside a
-- folder named after their own user id (e.g. "<uid>/avatar.webp"). 1 MB max.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatar read own" on storage.objects;
create policy "avatar read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatar upload own" on storage.objects;
create policy "avatar upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatar replace own" on storage.objects;
create policy "avatar replace own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatar delete own" on storage.objects;
create policy "avatar delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
