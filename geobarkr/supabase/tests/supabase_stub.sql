-- Just enough of Supabase to test GeoBarkr's SQL on a plain local Postgres:
-- the anon/authenticated roles, auth.users + auth.uid(), and realtime.send /
-- realtime.topic / realtime.messages. Never run this on the real project.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants these by default; GeoBarkr's 003 must take them away.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
  ), '')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated;

create schema realtime;
grant usage on schema realtime to anon, authenticated;
create table realtime.messages (
  id bigserial primary key,
  topic text not null,
  extension text not null,
  event text,
  payload jsonb,
  private boolean
);
alter table realtime.messages enable row level security;
grant select on realtime.messages to authenticated;
create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$
  insert into realtime.messages (topic, extension, event, payload, private)
  values (topic, 'broadcast', event, payload, private);
$$;
create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '');
$$;
grant execute on function realtime.topic() to authenticated;
