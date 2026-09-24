-- TapMap: complete Supabase setup (schema.sql + locations.sql in one file).
-- Paste ALL of this into SQL Editor → New query → Run. Safe to run again.

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
grant update (username, display_name, avatar_url) on public.profiles to authenticated;
grant insert, delete on public.follows to authenticated;
grant update (status) on public.follows to authenticated;
grant insert on public.games to authenticated;

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


-- TapMap location pool. Run after schema.sql (SQL Editor → New query → Run).
-- Safe to re-run: existing places are left as they are.
--
-- Add places in the dashboard (Table Editor → locations → Insert row) or with
-- SQL, for example:
--   insert into public.locations (name, lat, lng, difficulty)
--   values ('Table Mountain, South Africa', -33.9628, 18.4098, 'medium');
--
-- New places join the daily pool the day after they are added (UTC), so a
-- day that has started never changes. Set retired_on to take one out from that
-- date. Delete rows only if they were never in a daily game.

create table if not exists public.locations (
  id bigint generated always as identity primary key,
  name text not null unique check (char_length(trim(name)) between 2 and 120),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  added_on date not null default (now() at time zone 'utc')::date,
  retired_on date,
  notes text,
  created_at timestamptz not null default now(),
  check (retired_on is null or retired_on > added_on)
);

create index if not exists locations_pool_idx on public.locations (added_on, retired_on);

alter table public.locations enable row level security;

-- Everyone can read the pool; only you (dashboard / service role) can change it.
drop policy if exists "locations are public" on public.locations;
create policy "locations are public" on public.locations
  for select to anon, authenticated using (true);

grant select on public.locations to anon, authenticated;

-- The launch set, matching tapmap/locations.js in the same order (the daily
-- picks depend on this order, so ids follow it).
insert into public.locations (name, lat, lng, difficulty, added_on)
select name, lat, lng, difficulty, date '2026-01-01'
from (values
  (1, 'Eiffel Tower, Paris, France', 48.8584, 2.2945, 'easy'),
  (2, 'Statue of Liberty, New York, USA', 40.6892, -74.0445, 'easy'),
  (3, 'Great Pyramid of Giza, Egypt', 29.9792, 31.1342, 'easy'),
  (4, 'Sydney Opera House, Australia', -33.8568, 151.2153, 'easy'),
  (5, 'Colosseum, Rome, Italy', 41.8902, 12.4922, 'easy'),
  (6, 'Taj Mahal, Agra, India', 27.1751, 78.0421, 'easy'),
  (7, 'Big Ben, London, UK', 51.5007, -0.1246, 'easy'),
  (8, 'Christ the Redeemer, Rio de Janeiro, Brazil', -22.9519, -43.2105, 'easy'),
  (9, 'Mount Fuji, Japan', 35.3606, 138.7274, 'easy'),
  (10, 'Golden Gate Bridge, San Francisco, USA', 37.8199, -122.4783, 'easy'),
  (11, 'Tokyo, Japan', 35.6762, 139.6503, 'easy'),
  (12, 'Machu Picchu, Peru', -13.1631, -72.545, 'easy'),
  (13, 'Great Wall at Badaling, China', 40.3587, 116.02, 'easy'),
  (14, 'Niagara Falls, Canada/USA', 43.0896, -79.0849, 'easy'),
  (15, 'Grand Canyon, Arizona, USA', 36.1069, -112.1129, 'easy'),
  (16, 'Mount Everest, Nepal/China', 27.9881, 86.925, 'easy'),
  (17, 'Red Square, Moscow, Russia', 55.7539, 37.6208, 'easy'),
  (18, 'Cape Town, South Africa', -33.9249, 18.4241, 'easy'),
  (19, 'Burj Khalifa, Dubai, UAE', 25.1972, 55.2744, 'easy'),
  (20, 'Acropolis, Athens, Greece', 37.9715, 23.7257, 'easy'),
  (21, 'Petra, Jordan', 30.3285, 35.4444, 'medium'),
  (22, 'Angkor Wat, Cambodia', 13.4125, 103.867, 'medium'),
  (23, 'Chichén Itzá, Mexico', 20.6843, -88.5678, 'medium'),
  (24, 'Uluru, Australia', -25.3444, 131.0369, 'medium'),
  (25, 'Victoria Falls, Zambia/Zimbabwe', -17.9243, 25.8572, 'medium'),
  (26, 'Mount Kilimanjaro, Tanzania', -3.0674, 37.3556, 'medium'),
  (27, 'Iguazu Falls, Argentina/Brazil', -25.6953, -54.4367, 'medium'),
  (28, 'Reykjavík, Iceland', 64.1466, -21.9426, 'medium'),
  (29, 'Istanbul, Turkey', 41.0082, 28.9784, 'medium'),
  (30, 'Buenos Aires, Argentina', -34.6037, -58.3816, 'medium'),
  (31, 'Nairobi, Kenya', -1.2921, 36.8219, 'medium'),
  (32, 'Bangkok, Thailand', 13.7563, 100.5018, 'medium'),
  (33, 'Stonehenge, England', 51.1789, -1.8262, 'medium'),
  (34, 'Santorini, Greece', 36.3932, 25.4615, 'medium'),
  (35, 'Galápagos Islands, Ecuador', -0.9538, -90.9656, 'medium'),
  (36, 'Banff, Alberta, Canada', 51.1784, -115.5708, 'medium'),
  (37, 'Ha Long Bay, Vietnam', 20.9101, 107.1839, 'medium'),
  (38, 'Serengeti, Tanzania', -2.3333, 34.8333, 'medium'),
  (39, 'Dead Sea, Israel/Jordan', 31.559, 35.4732, 'medium'),
  (40, 'Marrakesh, Morocco', 31.6295, -7.9811, 'medium'),
  (41, 'Kyoto, Japan', 35.0116, 135.7681, 'medium'),
  (42, 'Singapore', 1.3521, 103.8198, 'medium'),
  (43, 'Honolulu, Hawaii, USA', 21.3069, -157.8583, 'medium'),
  (44, 'Anchorage, Alaska, USA', 61.2181, -149.9003, 'medium'),
  (45, 'Great Barrier Reef, Australia', -16.75, 146, 'medium'),
  (46, 'Mexico City, Mexico', 19.4326, -99.1332, 'medium'),
  (47, 'Havana, Cuba', 23.1136, -82.3666, 'medium'),
  (48, 'Auckland, New Zealand', -36.8485, 174.7633, 'medium'),
  (49, 'Easter Island, Chile', -27.1127, -109.3497, 'hard'),
  (50, 'Suva, Fiji', -18.1248, 178.4501, 'hard'),
  (51, 'Timbuktu, Mali', 16.7666, -3.0026, 'hard'),
  (52, 'Ulaanbaatar, Mongolia', 47.8864, 106.9057, 'hard'),
  (53, 'Longyearbyen, Svalbard, Norway', 78.2232, 15.6267, 'hard'),
  (54, 'Socotra, Yemen', 12.4634, 53.8237, 'hard'),
  (55, 'Lake Baikal, Russia', 53.5587, 108.165, 'hard'),
  (56, 'Salar de Uyuni, Bolivia', -20.1338, -67.4891, 'hard'),
  (57, 'Bagan, Myanmar', 21.1717, 94.8585, 'hard'),
  (58, 'Nuuk, Greenland', 64.1814, -51.6941, 'hard'),
  (59, 'Ushuaia, Argentina', -54.8019, -68.303, 'hard'),
  (60, 'Lalibela, Ethiopia', 12.0317, 39.0473, 'hard'),
  (61, 'Tristan da Cunha', -37.1052, -12.2777, 'hard'),
  (62, 'Samarkand, Uzbekistan', 39.627, 66.975, 'hard'),
  (63, 'McMurdo Station, Antarctica', -77.8419, 166.6863, 'hard'),
  (64, 'Sossusvlei, Namibia', -24.7275, 15.3428, 'hard'),
  (65, 'Cradle Mountain, Tasmania, Australia', -41.6848, 145.951, 'hard'),
  (66, 'Apia, Samoa', -13.8506, -171.7513, 'hard'),
  (67, 'Nazca Lines, Peru', -14.739, -75.13, 'hard'),
  (68, 'Koror, Palau', 7.3419, 134.4792, 'hard')
) as seed (n, name, lat, lng, difficulty)
order by n
on conflict (name) do nothing;
