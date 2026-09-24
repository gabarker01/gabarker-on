-- TapMap: delete ALL players. This removes every account (auth.users) and, by
-- cascade, every profile, follow and saved result. Locations are kept.
-- This cannot be undone. Run in SQL Editor → New query → Run.

begin;
delete from auth.users;
-- Belt and braces in case anything was created without a login.
delete from public.follows;
delete from public.games;
delete from public.profiles;
commit;

select
  (select count(*) from auth.users) as users,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.follows) as follows,
  (select count(*) from public.games) as games,
  (select count(*) from public.locations) as locations_kept;
