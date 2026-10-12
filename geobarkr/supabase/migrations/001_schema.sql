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
