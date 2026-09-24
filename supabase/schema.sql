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

-- One row per player per daily game. Rows can't be edited or deleted by
-- players, so a day's result can't be replayed or rewritten.
create table if not exists public.games (
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_date date not null,
  game_number integer not null check (game_number > 0),
  -- [{ "score": 0-100, "tier": "🟩", "km": 412.3, "multiplier": 1.5, "guess": { "lat": .., "lng": .. } }, ...]
  rounds jsonb not null check (jsonb_typeof(rounds) = 'array' and jsonb_array_length(rounds) = 5),
  total integer not null check (total between 0 and 1000),
  created_at timestamptz not null default now(),
  primary key (user_id, game_date)
);

create index if not exists games_date_idx on public.games (game_date);

-- The TapMap number always matches the UTC date: No. 1 is 2026-09-24.
-- (NOT VALID: checks every new result without re-checking old rows.)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'games_number_matches_date') then
    alter table public.games add constraint games_number_matches_date
      check (game_number = (game_date - date '2026-09-24') + 1) not valid;
  end if;
end $$;

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
-- follow request are visible. A streak is a run of consecutive UTC dates; the current streak
-- counts only if its last game was today or yesterday.
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
    where r.user_id = p.id and r.last_date >= (now() at time zone 'utc')::date - 1
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

-- One row per daily game (date and TapMap number) with player count, average
-- and best. In the dashboard it covers everyone; in the app, what you can see.
create or replace view public.daily_summary
with (security_invoker = true)
as
select
  game_date,
  game_number,
  count(*)::integer as players,
  round(avg(total))::integer as average,
  max(total) as best
from public.games
group by game_date, game_number;

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
drop policy if exists "see your follows" on public.follows;
create policy "see your follows" on public.follows
  for select to authenticated
  using ((select auth.uid()) in (follower_id, followee_id));

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

-- Only your own result, and only for today's (or yesterday's) UTC game.
drop policy if exists "save own game" on public.games;
create policy "save own game" on public.games
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and game_date between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date
  );

-- ---------- Privileges ----------

grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon, authenticated;
revoke select on public.follows, public.games, public.profile_stats from anon;
grant select on public.follows, public.games, public.profile_stats, public.daily_summary to authenticated;
grant update (username, display_name) on public.profiles to authenticated;
grant insert, delete on public.follows to authenticated;
grant update (status) on public.follows to authenticated;
grant insert on public.games to authenticated;
