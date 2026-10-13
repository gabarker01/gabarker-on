-- GeoBarkr 003: who can see and change what (row-level security). Safe to re-run.
--
-- Roles (ServiceNow x_geobarkr.user → player, ServiceNow admin → admin):
--   signed out   nothing at all
--   player       read own profile and rename themselves; read active public
--                maps and their own maps (with their locations); read games
--                they host or play in, and those games' players; read their
--                own guesses; upload photos to their own folder of the
--                map-photos bucket; everything else (including making maps)
--                through the functions in 002
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
  using ((active and not blocked and (owner_id is null or is_public)) or owner_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "admins manage maps" on public.maps;
create policy "admins manage maps" on public.maps
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Locations are the answers: admins, and the owner of a player's map.
drop policy if exists "owners see their locations" on public.locations;
create policy "owners see their locations" on public.locations
  for select to authenticated
  using (exists (select 1 from public.maps m where m.id = map_id and m.owner_id = (select auth.uid())));

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
  public.leaderboard(text, integer),
  public.playable_maps(),
  public.my_maps(),
  public.get_my_map(uuid),
  public.create_my_map(text, text, public.map_kind, boolean),
  public.update_my_map(uuid, text, text, boolean, boolean),
  public.save_my_location(uuid, integer, text, double precision, double precision, double precision, double precision, text),
  public.delete_my_location(uuid, integer),
  public.delete_my_map(uuid),
  public.can_upload_photo(text),
  public.photo_unused(text),
  public.my_stats()
to authenticated;

-- ---------- Storage: photos for photo maps ----------

-- Public to read (a round's photo is shown to everyone in the game; file
-- names are random), JPEG or WebP up to 5 MB. The browser re-encodes photos
-- before uploading, which also strips their location data.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('map-photos', 'map-photos', true, 5242880, array['image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "geobarkr players upload map photos" on storage.objects;
create policy "geobarkr players upload map photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'map-photos' and public.can_upload_photo(name));

drop policy if exists "geobarkr players see their map photos" on storage.objects;
create policy "geobarkr players see their map photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'map-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Only photos no map or game uses any more.
drop policy if exists "geobarkr players delete their map photos" on storage.objects;
create policy "geobarkr players delete their map photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'map-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and public.photo_unused(name));

-- ---------- Realtime ----------

-- Each game broadcasts on the private channel "game:<id>"; only its host and
-- players (and admins) can listen.
drop policy if exists "game members receive game events" on realtime.messages;
create policy "game members receive game events" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.can_listen((select realtime.topic())));

-- Tell the API (PostgREST) to pick up new or changed functions straight away.
notify pgrst, 'reload schema';
