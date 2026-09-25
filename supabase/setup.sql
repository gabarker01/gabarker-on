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
  -- (A satellite round, "sat": true, is out of 120; daily games have none.)
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

-- The total must be what the rounds add up to: each round's score (0 to 100,
-- or 0 to 120 for a satellite round) times its multiplier, rounded. The most
-- a game can score is 1,000, or 1,200 when every round is a satellite round.
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
    if score <> trunc(score) or score < 0 or score > (case when r ->> 'sat' = 'true' then 120 else 100 end)
       or multiplier not in (1, 1.5, 2, 2.5, 3) then
      return false;
    end if;
    weighted := weighted + score * multiplier;
  end loop;
  return total = round(weighted) and total between 0 and 1200;
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

-- ---------- Privileges ----------

grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon, authenticated;
revoke select on public.follows, public.games, public.profile_stats, public.weekly_league from anon;
grant select on public.follows, public.games, public.profile_stats, public.daily_summary, public.weekly_league to authenticated;
grant update (username, display_name, avatar_url, time_zone) on public.profiles to authenticated;
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
-- added_on defaults to tomorrow's UTC date and a place is used from the day
-- after added_on, so a new place joins two days later. Players' dates run from
-- UTC-12 to UTC+14, so no day that has started anywhere ever changes. Set
-- retired_on (at least two days ahead) to take one out from that date. Don't
-- rename or delete a place that has been in a daily game: the picker tracks
-- places by name.

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

alter table public.locations
  alter column added_on set default ((now() at time zone 'utc')::date + 1);

create index if not exists locations_pool_idx on public.locations (added_on, retired_on);

alter table public.locations enable row level security;

-- Everyone can read the pool; only you (dashboard / service role) can change it.
drop policy if exists "locations are public" on public.locations;
create policy "locations are public" on public.locations
  for select to anon, authenticated using (true);

grant select on public.locations to anon, authenticated;

-- The launch set, matching tapmap/locations.js in the same order. (Games
-- before 27 September 2026 depend on this order, so ids follow it. From then
-- on places are matched by name, so the order no longer matters.)
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

-- One line about each launch place, shown when the answer is revealed. Only
-- fills notes that are empty, so your own edits are never overwritten.
update public.locations l
set notes = v.notes
from (values
  ('Eiffel Tower, Paris, France', 'Built for the 1889 World''s Fair, it was only meant to stand for 20 years.'),
  ('Statue of Liberty, New York, USA', 'A gift from France, dedicated in 1886. Its copper skin is thinner than 2.5 mm.'),
  ('Great Pyramid of Giza, Egypt', 'It was the tallest human-made structure on Earth for more than 3,800 years.'),
  ('Sydney Opera House, Australia', 'Its roof sails are covered in over a million tiles made in Sweden.'),
  ('Colosseum, Rome, Italy', 'It could seat an estimated 50,000 to 80,000 spectators.'),
  ('Taj Mahal, Agra, India', 'Shah Jahan built it as a tomb for his wife Mumtaz Mahal. Work began in 1632.'),
  ('Big Ben, London, UK', 'Big Ben is the great bell, not the tower, which has been called Elizabeth Tower since 2012.'),
  ('Christ the Redeemer, Rio de Janeiro, Brazil', 'Finished in 1931, the statue is 30 m tall, not counting its pedestal.'),
  ('Mount Fuji, Japan', 'Japan''s highest peak, at 3,776 m. It last erupted in 1707.'),
  ('Golden Gate Bridge, San Francisco, USA', 'Its colour, International Orange, was chosen to stand out in the fog.'),
  ('Tokyo, Japan', 'Greater Tokyo is the world''s most populous metropolitan area, with about 37 million people.'),
  ('Machu Picchu, Peru', 'The Inca built this citadel in the 15th century, about 2,430 m above sea level.'),
  ('Great Wall at Badaling, China', 'Badaling is the Great Wall''s most visited section, and it opened to tourists in 1957.'),
  ('Niagara Falls, Canada/USA', 'Horseshoe Falls, on the Canadian side, carries about 90% of the river''s water.'),
  ('Grand Canyon, Arizona, USA', 'The Colorado River carved it up to 1.8 km deep.'),
  ('Mount Everest, Nepal/China', 'At 8,849 m, its summit is the highest point above sea level on Earth.'),
  ('Red Square, Moscow, Russia', 'Its name comes from an old Russian word for "beautiful", not from the colour.'),
  ('Cape Town, South Africa', 'The flat-topped Table Mountain rises straight up behind the city.'),
  ('Burj Khalifa, Dubai, UAE', 'At 828 m, it has been the world''s tallest building since 2010.'),
  ('Acropolis, Athens, Greece', 'The Parthenon was built on its summit in the 5th century BC.'),
  ('Petra, Jordan', 'The Nabataeans carved the city''s façades straight into rose-pink sandstone cliffs.'),
  ('Angkor Wat, Cambodia', 'The world''s largest religious monument, and it''s on Cambodia''s flag.'),
  ('Chichén Itzá, Mexico', 'At the equinoxes, shadows make a serpent that seems to slide down El Castillo''s steps.'),
  ('Uluru, Australia', 'This sandstone monolith rises about 348 m above the flat desert around it.'),
  ('Victoria Falls, Zambia/Zimbabwe', 'Its local name, Mosi-oa-Tunya, means "the smoke that thunders".'),
  ('Mount Kilimanjaro, Tanzania', 'Africa''s highest mountain, at 5,895 m, is a dormant volcano.'),
  ('Iguazu Falls, Argentina/Brazil', 'It is a chain of about 275 waterfalls on the border of Argentina and Brazil.'),
  ('Reykjavík, Iceland', 'It is the world''s northernmost capital of a sovereign state.'),
  ('Istanbul, Turkey', 'The city sits on both sides of the Bosphorus, so it is partly in Europe and partly in Asia.'),
  ('Buenos Aires, Argentina', 'Avenida 9 de Julio, one of the widest avenues in the world, runs through the centre.'),
  ('Nairobi, Kenya', 'Nairobi National Park is inside the city, and you can see giraffes against the skyline.'),
  ('Bangkok, Thailand', 'Its full ceremonial name is one of the longest place names in the world.'),
  ('Stonehenge, England', 'Its smaller bluestones were brought from the Preseli Hills in Wales, more than 200 km away.'),
  ('Santorini, Greece', 'The island''s crescent is the rim of a caldera left by a huge eruption around 1600 BC.'),
  ('Galápagos Islands, Ecuador', 'Their wildlife helped shape Charles Darwin''s thinking after he visited in 1835.'),
  ('Banff, Alberta, Canada', 'Banff, founded in 1885, is Canada''s first national park.'),
  ('Ha Long Bay, Vietnam', 'About 1,600 limestone islands and islets rise out of its water.'),
  ('Serengeti, Tanzania', 'It is home to the great migration of more than a million wildebeest.'),
  ('Dead Sea, Israel/Jordan', 'Its shore, more than 430 m below sea level, is the lowest land on Earth.'),
  ('Marrakesh, Morocco', 'Every evening its main square, Jemaa el-Fnaa, fills with food stalls and performers.'),
  ('Kyoto, Japan', 'It was Japan''s capital for more than a thousand years, until 1869.'),
  ('Singapore', 'This city-state of more than 60 islands lies just north of the equator.'),
  ('Honolulu, Hawaii, USA', 'ʻIolani Palace is here, the only royal palace in the United States.'),
  ('Anchorage, Alaska, USA', 'Alaska''s largest city is home to about two in five Alaskans.'),
  ('Great Barrier Reef, Australia', 'The world''s largest coral reef system stretches more than 2,300 km.'),
  ('Mexico City, Mexico', 'It was built on the site of the Aztec capital Tenochtitlan, on a drained lake bed.'),
  ('Havana, Cuba', 'The Spanish founded it in 1519, and its old town is a World Heritage Site.'),
  ('Auckland, New Zealand', 'The city is built on a field of about 50 volcanoes.'),
  ('Easter Island, Chile', 'The Rapa Nui people carved nearly 1,000 moai statues here.'),
  ('Suva, Fiji', 'Fiji''s capital is on Viti Levu, the country''s largest island.'),
  ('Timbuktu, Mali', 'In the 15th and 16th centuries it was a great centre of Islamic learning.'),
  ('Ulaanbaatar, Mongolia', 'It is often called the coldest capital city in the world.'),
  ('Longyearbyen, Svalbard, Norway', 'The Svalbard Global Seed Vault is here, holding seeds from around the world.'),
  ('Socotra, Yemen', 'The island is known for its umbrella-shaped dragon''s blood trees, which grow nowhere else.'),
  ('Lake Baikal, Russia', 'The world''s deepest lake holds about a fifth of Earth''s unfrozen surface fresh water.'),
  ('Salar de Uyuni, Bolivia', 'After rain, the world''s largest salt flat becomes a giant mirror.'),
  ('Bagan, Myanmar', 'More than 2,000 Buddhist temples and pagodas still stand on its plain.'),
  ('Nuuk, Greenland', 'Greenland''s capital was founded in 1728 and is one of the smallest capitals in the world.'),
  ('Ushuaia, Argentina', 'It is often called the southernmost city in the world.'),
  ('Lalibela, Ethiopia', 'Its 11 medieval churches were carved downwards out of solid rock.'),
  ('Tristan da Cunha', 'Fewer than 300 people live on the world''s most remote inhabited island group.'),
  ('Samarkand, Uzbekistan', 'On this Silk Road city''s Registan square stand three madrasas covered in tiles.'),
  ('McMurdo Station, Antarctica', 'The United States runs Antarctica''s largest research station here.'),
  ('Sossusvlei, Namibia', 'Some of its red dunes are more than 300 m high, among the tallest in the world.'),
  ('Cradle Mountain, Tasmania, Australia', 'It is the start of the Overland Track, one of Australia''s best-known long walks.'),
  ('Apia, Samoa', 'Samoa is just west of the International Date Line, so it is among the first places to see each new day.'),
  ('Nazca Lines, Peru', 'These giant figures were scratched into the desert about 2,000 years ago and are best seen from the air.'),
  ('Koror, Palau', 'Palau''s largest town was its capital until 2006.')
) as v (name, notes)
where l.name = v.name and (l.notes is null or trim(l.notes) = '');

-- More places, added 27 September 2026 (65: 16 easy, 22 medium, 27 hard).
-- added_on is set explicitly (not the default) so it matches the built-in list
-- in tapmap/locations.js: they join the daily pool on 28 September. Only
-- inserts places that aren't there yet; nothing is changed or removed.
insert into public.locations (name, lat, lng, difficulty, added_on, notes)
select name, lat, lng, difficulty, date '2026-09-27', notes
from (values
  (1, 'Leaning Tower of Pisa, Italy', 43.723, 10.3966, 'easy', 'It started to lean in the 1170s, while it was still being built, because the ground is soft.'),
  (2, 'Sagrada Família, Barcelona, Spain', 41.4036, 2.1744, 'easy', 'Gaudí''s basilica has been under construction since 1882.'),
  (3, 'Brandenburg Gate, Berlin, Germany', 52.5163, 13.3777, 'easy', 'Built in the 1790s, it stood right by the Berlin Wall from 1961 to 1989.'),
  (4, 'Chicago, USA', 41.8781, -87.6298, 'easy', 'The world''s first skyscraper, the Home Insurance Building, went up here in 1885.'),
  (5, 'Forbidden City, Beijing, China', 39.9163, 116.3972, 'easy', 'It was the home of China''s emperors for almost 500 years.'),
  (6, 'Hollywood Sign, Los Angeles, USA', 34.1341, -118.3215, 'easy', 'It first read "Hollywoodland", an advert for a housing development in 1923.'),
  (7, 'Mount Rushmore, South Dakota, USA', 43.8791, -103.4591, 'easy', 'Each of the four presidents'' faces is about 18 m tall.'),
  (8, 'Neuschwanstein Castle, Germany', 47.5576, 10.7498, 'easy', 'This 19th-century castle inspired Disney''s Sleeping Beauty castle.'),
  (9, 'Venice, Italy', 45.4408, 12.3155, 'easy', 'The city is built on 118 small islands, linked by more than 400 bridges.'),
  (10, 'Hong Kong', 22.3193, 114.1694, 'easy', 'It has more skyscrapers than any other city in the world.'),
  (11, 'Las Vegas Strip, Nevada, USA', 36.1147, -115.1728, 'easy', 'Most of the Strip is actually outside Las Vegas, in the town of Paradise.'),
  (12, 'Amsterdam, Netherlands', 52.3676, 4.9041, 'easy', 'The city has more than 100 km of canals.'),
  (13, 'Petronas Towers, Kuala Lumpur, Malaysia', 3.1579, 101.7116, 'easy', 'They were the world''s tallest buildings from 1998 to 2004.'),
  (14, 'CN Tower, Toronto, Canada', 43.6426, -79.3871, 'easy', 'It was the world''s tallest free-standing structure for more than 30 years.'),
  (15, 'Seoul, South Korea', 37.5665, 126.978, 'easy', 'About half of South Korea''s people live in the Seoul metropolitan area.'),
  (16, 'Mont-Saint-Michel, France', 48.6361, -1.5115, 'easy', 'At high tide, the sea can cut this abbey island off from the mainland.'),
  (17, 'Matterhorn, Switzerland/Italy', 45.9763, 7.6586, 'medium', 'The first ascent, in 1865, ended in tragedy: four of the seven climbers died on the way down.'),
  (18, 'Cappadocia, Turkey', 38.6431, 34.8289, 'medium', 'People carved homes and churches into its soft rock "fairy chimneys".'),
  (19, 'Geirangerfjord, Norway', 62.1049, 7.094, 'medium', 'Its waterfalls include the Seven Sisters, which tumble down the fjord''s cliffs.'),
  (20, 'Lake Titicaca, Peru/Bolivia', -15.9254, -69.3354, 'medium', 'At about 3,800 m, it''s often called the highest navigable lake in the world.'),
  (21, 'Yellowstone, Wyoming, USA', 44.428, -110.5885, 'medium', 'Founded in 1872, it''s often called the world''s first national park.'),
  (22, 'Pamukkale, Turkey', 37.9204, 29.1212, 'medium', 'Its white terraces are made of travertine left behind by hot springs.'),
  (23, 'Lisbon, Portugal', 38.7223, -9.1393, 'medium', 'A huge earthquake in 1755 destroyed much of the city.'),
  (24, 'Edinburgh, Scotland', 55.9533, -3.1883, 'medium', 'Its castle stands on the plug of an extinct volcano.'),
  (25, 'Dubrovnik, Croatia', 42.6507, 18.0944, 'medium', 'Medieval walls nearly 2 km long surround its old town.'),
  (26, 'Stone Town, Zanzibar, Tanzania', -6.1659, 39.2026, 'medium', 'It was a hub of the Indian Ocean spice trade.'),
  (27, 'Bora Bora, French Polynesia', -16.5004, -151.7415, 'medium', 'A lagoon and barrier reef ring the island''s volcanic peaks.'),
  (28, 'Malé, Maldives', 4.1755, 73.5093, 'medium', 'The Maldives is the world''s lowest-lying country, about 1.5 m above sea level on average.'),
  (29, 'Quebec City, Canada', 46.8139, -71.208, 'medium', 'Its old town has the only surviving city walls in North America north of Mexico.'),
  (30, 'New Orleans, Louisiana, USA', 29.9511, -90.0715, 'medium', 'Much of the city lies below sea level.'),
  (31, 'Cartagena, Colombia', 10.391, -75.4794, 'medium', 'Its old town''s walls were built to keep out pirates.'),
  (32, 'Atacama Desert, Chile', -22.9087, -68.1997, 'medium', 'It''s one of the driest places on Earth.'),
  (33, 'Torres del Paine, Chile', -50.9423, -73.4068, 'medium', 'Its granite towers rise above Patagonian glaciers and lakes.'),
  (34, 'Okavango Delta, Botswana', -19.3, 22.9, 'medium', 'Its river floods inland into the Kalahari instead of reaching the sea.'),
  (35, 'Zhangjiajie, China', 29.3249, 110.4343, 'medium', 'Its sandstone pillars inspired the floating mountains in the film Avatar.'),
  (36, 'Ubud, Bali, Indonesia', -8.5069, 115.2625, 'medium', 'Bali''s rice terraces are watered by subak, an irrigation system over a thousand years old.'),
  (37, 'Milford Sound, New Zealand', -44.6414, 167.8974, 'medium', 'It''s one of the wettest inhabited places on Earth.'),
  (38, 'Pompeii, Italy', 40.7489, 14.4989, 'medium', 'Mount Vesuvius buried the Roman town in AD 79.'),
  (39, 'Lhasa, Tibet, China', 29.652, 91.1721, 'hard', 'At about 3,650 m, it''s one of the world''s highest cities, with the Potala Palace above it.'),
  (40, 'Tórshavn, Faroe Islands', 62.0079, -6.79, 'hard', 'One of the world''s smallest capitals, where a parliament has met since Viking times.'),
  (41, 'Pitcairn Islands', -25.066, -130.1015, 'hard', 'About 40 people live here, many descended from the Bounty mutineers.'),
  (42, 'Kerguelen Islands', -49.35, 70.2167, 'hard', 'Among the most isolated places on Earth, they''re also called the Desolation Islands.'),
  (43, 'Norilsk, Russia', 69.3558, 88.1893, 'hard', 'One of the world''s northernmost cities, with no road to the rest of Russia.'),
  (44, 'Oymyakon, Russia', 63.4608, 142.7858, 'hard', 'Often called the coldest place where people live all year, it has recorded about −68 °C.'),
  (45, 'Funafuti, Tuvalu', -8.5211, 179.1983, 'hard', 'Tuvalu is one of the world''s smallest countries, with about 11,000 people.'),
  (46, 'Nauru', -0.5228, 166.9315, 'hard', 'One of the world''s smallest countries, at about 21 km².'),
  (47, 'Alice Springs, Australia', -23.698, 133.8807, 'hard', 'This outback town is close to the middle of Australia.'),
  (48, 'Kiruna, Sweden', 67.8558, 20.2253, 'hard', 'The town is being moved about 3 km to make room for the iron ore mine under it.'),
  (49, 'Iqaluit, Nunavut, Canada', 63.7467, -68.517, 'hard', 'It''s the capital of Nunavut, Canada''s newest territory, created in 1999.'),
  (50, 'Leh, Ladakh, India', 34.1526, 77.5771, 'hard', 'At about 3,500 m, this Himalayan town is reached by some of the world''s highest roads.'),
  (51, 'Great Blue Hole, Belize', 17.3157, -87.5346, 'hard', 'This sinkhole in the reef is about 300 m across and more than 120 m deep.'),
  (52, 'Danakil Depression, Ethiopia', 14.2417, 40.3, 'hard', 'One of the hottest places on Earth, with acid pools and salt flats below sea level.'),
  (53, 'Moynaq, Uzbekistan', 43.7683, 59.0214, 'hard', 'Once a fishing port on the Aral Sea, it now sits in desert far from the shrunken shore.'),
  (54, 'Darvaza Gas Crater, Turkmenistan', 40.2525, 58.4397, 'hard', 'Nicknamed the Door to Hell, this crater has been burning since it was set alight in 1971.'),
  (55, 'Mount Roraima, Venezuela/Brazil/Guyana', 5.1433, -60.7625, 'hard', 'Venezuela, Brazil and Guyana meet on its flat top.'),
  (56, 'Angel Falls, Venezuela', 5.9701, -62.5362, 'hard', 'At 979 m, it''s the world''s tallest waterfall with an unbroken drop.'),
  (57, 'Jamestown, Saint Helena', -15.9244, -5.7181, 'hard', 'Napoleon was exiled to this island and died here in 1821.'),
  (58, 'Tiger''s Nest, Bhutan', 27.4919, 89.3632, 'hard', 'This monastery clings to a cliff about 900 m above the Paro valley.'),
  (59, 'Mount Yasur, Tanna, Vanuatu', -19.532, 169.447, 'hard', 'This volcano has been erupting almost non-stop for centuries.'),
  (60, 'Lake Assal, Djibouti', 11.6583, 42.4167, 'hard', 'About 155 m below sea level, it''s the lowest point in Africa.'),
  (61, 'Churchill, Manitoba, Canada', 58.7684, -94.165, 'hard', 'It''s known as the polar bear capital of the world.'),
  (62, 'Deception Island, Antarctica', -62.9667, -60.65, 'hard', 'Ships sail right into the flooded crater of this active volcano.'),
  (63, 'Utqiaġvik, Alaska, USA', 71.2906, -156.7887, 'hard', 'In the northernmost town in the US, the sun doesn''t set for more than 80 days in summer.'),
  (64, 'Avenue of the Baobabs, Madagascar', -20.2507, 44.4186, 'hard', 'Giant baobab trees, some hundreds of years old, line this dirt road.'),
  (65, 'Chocolate Hills, Bohol, Philippines', 9.8297, 124.1398, 'hard', 'More than 1,200 grassy mounds here turn brown in the dry season.')
) as more (n, name, lat, lng, difficulty, notes)
order by n
on conflict (name) do nothing;
