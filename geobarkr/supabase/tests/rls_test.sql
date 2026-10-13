-- GeoBarkr SQL tests: game flow and row-level security.
-- Run with geobarkr/supabase/tests/run.sh (a throwaway local Postgres).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = notice;

create schema test;
grant usage on schema test to anon, authenticated;

-- Act as a signed-in user (or signed out with null).
create function test.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, false);
end;
$$;
grant execute on function test.act_as(uuid) to anon, authenticated;

-- Run a statement and require it to fail with a message matching p_pattern.
create function test.expect_error(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'Expected an error matching "%" from: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'Expected an error%' then raise; end if;
  if sqlerrm !~* p_pattern then
    raise exception 'Wrong error from %: % (wanted %)', p_sql, sqlerrm, p_pattern;
  end if;
end;
$$;
grant execute on function test.expect_error(text, text) to anon, authenticated;

create function test.eq(p_got anyelement, p_want anyelement, p_what text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'FAIL %: got %, wanted %', p_what, p_got, p_want;
  end if;
  raise notice 'ok - %', p_what;
end;
$$;
grant execute on function test.eq(anyelement, anyelement, text) to anon, authenticated;

create table test.ids (name text primary key, id uuid);
grant all on test.ids to anon, authenticated;
create function test.id(p_name text) returns uuid language sql stable as $$ select id from test.ids where name = p_name $$;
grant execute on function test.id(text) to anon, authenticated;

-- ---------- Users ----------

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-00000000000a', 'george@example.com', '{"full_name": "George Barker", "avatar_url": "https://lh3.googleusercontent.com/a/photo"}'),
  ('b0000000-0000-0000-0000-00000000000b', 'bob@example.com', '{}'),
  ('c0000000-0000-0000-0000-00000000000c', 'carol@example.com', '{"name": "Carol"}'),
  ('d0000000-0000-0000-0000-00000000000d', 'dave@example.com', '{}');
update public.profiles set role = 'admin' where id = 'a0000000-0000-0000-0000-00000000000a';
insert into test.ids values
  ('admin', 'a0000000-0000-0000-0000-00000000000a'), ('bob', 'b0000000-0000-0000-0000-00000000000b'),
  ('carol', 'c0000000-0000-0000-0000-00000000000c'), ('dave', 'd0000000-0000-0000-0000-00000000000d'),
  ('map', 'eb30f2ba-939a-f610-0fa1-7bfdfaba1097');

select test.eq((select display_name from public.profiles where id = test.id('admin')), 'George Barker', 'profile named from Google full_name');
select test.eq((select display_name from public.profiles where id = test.id('bob')), 'bob', 'profile named from email');
select test.eq((select display_name from public.profiles where id = test.id('carol')), 'Carol', 'profile named from name');
select test.eq((select avatar_url from public.profiles where id = test.id('admin')), 'https://lh3.googleusercontent.com/a/photo', 'Google photo kept for the pin');
select test.eq((select avatar_url from public.profiles where id = test.id('bob')), null, 'no photo: initials');

-- ---------- Scoring matches ServiceNow ----------

select test.eq(public.round_distance_km(1234.5), 1235::double precision, 'whole km from 10 km');
select test.eq(public.round_distance_km(3.25), 3.3::double precision, '0.1 km under 10 km');
select test.eq(public.score_for_distance(0), 5000, 'full marks under 10 m');
select test.eq(public.score_for_distance(100), 4756, '100 km');
select test.eq(public.score_for_distance(1000), 3033, '1000 km');
select test.eq(public.score_for_distance(5000), 410, '5000 km');
select test.eq(public.round_distance_km(public.haversine_km(51.5, -0.12, 48.86, 2.35)), 342::double precision, 'London–Paris 342 km (same as the ServiceNow formula)');
select test.eq(public.round_distance_km(public.haversine_km(38.71, 153.23, -38.71, -26.77)), 20015::double precision, 'opposite side of the world doesn''t error');

-- ---------- Signed out: blocked from everything ----------

select from (select test.act_as(null)) s;
select test.expect_error('select count(*) from public.maps', 'permission denied');
select test.expect_error('select count(*) from public.games', 'permission denied');
select test.expect_error('select count(*) from public.profiles', 'permission denied');
select test.expect_error($$select public.create_game('single_player', test.id('map'))$$, 'permission denied');
select test.expect_error($$select public.join_game('ABCDEF')$$, 'permission denied');
select test.expect_error('select public.leaderboard()', 'permission denied');
reset role;

-- ---------- A player can't see answers or admin data ----------

select from (select test.act_as(test.id('bob'))) s;
select test.eq((select count(*) from public.maps), 2::bigint, 'player sees the active maps');
select test.eq((select count(*) from public.locations), 0::bigint, 'player cannot read locations (answers)');
select test.eq((select count(*) from public.profiles), 1::bigint, 'player sees only own profile');
select test.expect_error($$insert into public.maps (name) values ('Hack')$$, 'row-level security');
select test.expect_error($$insert into public.locations (map_id, name, round_number, lat, lng) values (test.id('map'), 'x', 1, 0, 0)$$, 'row-level security');
select test.expect_error($$update public.profiles set role = 'admin' where id = test.id('bob')$$, 'permission denied');
update public.profiles set display_name = 'Bobby' where id = test.id('bob');
update public.profiles set display_name = 'Hacked' where id = test.id('carol');
select test.expect_error($$insert into public.guesses (round_id, player_id, lat, lng, distance_km, score, time_ms) values (gen_random_uuid(), gen_random_uuid(), 0, 0, 0, 5000, 0)$$, 'permission denied');
select test.expect_error($$select public.notify_game(test.id('map'), 'x')$$, 'permission denied');
reset role;
select test.eq((select display_name from public.profiles where id = test.id('bob')), 'Bobby', 'player can rename themselves');
select test.eq((select display_name from public.profiles where id = test.id('carol')), 'Carol', 'player cannot rename someone else');

-- ---------- Single player: five rounds ----------

select from (select test.act_as(test.id('bob'))) s;
insert into test.ids select 'solo', (public.create_game('single_player', test.id('map')) ->> 'id')::uuid;
select test.eq(public.get_game_state(test.id('solo')) #>> '{game,status}', 'in_play', 'single player starts in play');
select test.eq(public.get_game_state(test.id('solo')) #>> '{round,number}', '1', 'round 1 started');
select test.eq((public.get_game_state(test.id('solo')) #>> '{round,target,heading}')::numeric, 120::numeric, 'single player sees the Street View target');
-- Guess at the Eiffel Tower for 4 Medley Road.
select test.eq(public.get_game_state(test.id('solo')) #>> '{round,place}', null, 'place name hidden during the round');
select test.eq((public.submit_guess(test.id('solo'), 48.859, 2.296) ->> 'round_complete')::boolean, true, 'solo round ends on guess');
select test.eq(public.get_game_state(test.id('solo')) #>> '{round,place}', '4 Medley Road', 'place name shown at results');
select test.expect_error($$select public.submit_guess(test.id('solo'), 0, 0)$$, 'round has finished');
select test.eq((public.get_game_state(test.id('solo')) #>> '{guesses,0,score}')::int, public.score_for_distance(public.round_distance_km(public.haversine_km(48.859, 2.296, 51.54713683719802, -0.1947690014365771))), 'score computed on the server');
select test.eq(public.next_round(test.id('solo')), 'next', 'next round');
select from (select public.submit_guess(test.id('solo'), 51.516, -0.1255)) s;
select from (select public.next_round(test.id('solo'))) s;
select from (select public.submit_guess(test.id('solo'), 48.859, 2.296)) s;
select from (select public.next_round(test.id('solo'))) s;
select from (select public.submit_guess(test.id('solo'), -33.85, 151.21)) s;
select from (select public.next_round(test.id('solo'))) s;
select test.expect_error($$select public.next_round(test.id('solo'))$$, 'Wait for everyone');
select from (select public.submit_guess(test.id('solo'), -22.97, -43.18)) s;
select test.eq(public.next_round(test.id('solo')), 'complete', 'game completes after round 5');
select test.eq(public.get_results(test.id('solo')) #>> '{game,status}', 'complete', 'results: complete');
select test.eq(jsonb_array_length(public.get_results(test.id('solo')) #> '{players,0,guesses}'), 5, 'results: five guesses');
select test.eq((select count(*) from public.rounds), 0::bigint, 'player cannot read rounds table directly');
select test.eq((select count(*) from public.guesses), 5::bigint, 'player reads own guesses');
reset role;

-- ---------- Online multiplayer ----------

select from (select test.act_as(test.id('bob'))) s;
insert into test.ids select 'online', (public.create_game('multiplayer', test.id('map')) ->> 'id')::uuid;
select test.expect_error($$select public.start_game(test.id('online'))$$, 'at least two players');
reset role;

select from (select test.act_as(test.id('carol'))) s;
select test.expect_error($$select public.get_game_state(test.id('online'))$$, 'Game not found');
select test.eq((select count(*) from public.games where id = test.id('online')), 0::bigint, 'outsider cannot see the game');
select test.expect_error($$select public.join_game('ZZZZZZ')$$, 'No game with that code');
reset role;
select from (select set_config('test.code', (select lower(code) from public.games where id = test.id('online')), false)) s;
select from (select test.act_as(test.id('carol'))) s;
select from (select public.join_game(current_setting('test.code'))) s;
select test.expect_error($$select public.start_game(test.id('online'))$$, 'Only the host');
reset role;

select from (select test.act_as(test.id('bob'))) s;
select from (select public.start_game(test.id('online'))) s;
reset role;

-- Cancelling a lobby: host only, before it starts; nobody can join after.
select from (select test.act_as(test.id('bob'))) s;
insert into test.ids select 'called_off', (public.create_game('multiplayer', test.id('map')) ->> 'id')::uuid;
reset role;
select from (select set_config('test.code2', (select code from public.games where id = test.id('called_off')), false)) s;
select from (select test.act_as(test.id('carol'))) s;
select from (select public.join_game(current_setting('test.code2'))) s;
select test.expect_error($$select public.cancel_game(test.id('called_off'))$$, 'Only the host');
reset role;
select from (select test.act_as(test.id('bob'))) s;
select from (select public.cancel_game(test.id('called_off'))) s;
select test.eq(public.get_game_state(test.id('called_off')) #>> '{game,status}', 'cancelled', 'host can cancel a lobby');
select test.expect_error($$select public.cancel_game(test.id('online'))$$, 'already started');
reset role;
select from (select test.act_as(test.id('dave'))) s;
select test.expect_error($$select public.join_game(current_setting('test.code2'))$$, 'was cancelled');
reset role;

select from (select test.act_as(test.id('dave'))) s;
select test.expect_error($$select public.join_game(current_setting('test.code'))$$, 'already started');
reset role;

select from (select test.act_as(test.id('carol'))) s;
select test.eq((public.get_game_state(test.id('online')) #>> '{round,target,lat}') is not null, true, 'online player sees the Street View target');
reset role;
select from (select test.act_as(test.id('bob'))) s;
select from (select public.submit_guess(test.id('online'), 51.5, -0.1)) s;
select test.expect_error($$select public.submit_guess(test.id('online'), 51.5, -0.1)$$, 'already guessed');
reset role;
select from (select test.act_as(test.id('carol'))) s;
select test.eq(public.get_game_state(test.id('online')) #> '{guesses,0}' ? 'lat', false, 'other players'' guess positions hidden until results');
select test.eq(public.get_game_state(test.id('online')) #>> '{guesses,0,name}', 'Bobby', 'but who guessed and when is shown');
select test.eq((select count(*) from public.guesses), 0::bigint, 'player cannot read other players'' guesses');
select test.eq((select total_score from public.game_players where game_id = test.id('online') and user_id = test.id('bob')), 0, 'other players'' totals don''t move until results');
select test.eq((public.get_game_state(test.id('online')) #>> '{players,0,total_score}')::int, 0, 'nor in the game state');
select test.expect_error($$select public.next_round(test.id('online'))$$, 'Only the host');
select test.eq((public.submit_guess(test.id('online'), 40, 0) ->> 'round_complete')::boolean, true, 'round ends when everyone has guessed');
select test.eq(public.get_game_state(test.id('online')) #> '{guesses,0}' ? 'lat', true, 'positions revealed at results');
select test.eq((select sum(total_score) from public.game_players where game_id = test.id('online')) > 0, true, 'totals added at results');
select test.eq((select count(*) from public.game_players where game_id = test.id('online')), 2::bigint, 'member sees the game''s players');
reset role;

-- ---------- In person ----------

select from (select test.act_as(test.id('bob'))) s;
insert into test.ids select 'party', (public.create_game('local_multiplayer', test.id('map')) ->> 'id')::uuid;
select test.eq((public.get_game_state(test.id('party')) #>> '{me,is_player}')::boolean, false, 'in-person host is not a player');
reset role;
select from (select set_config('test.code', (select code from public.games where id = test.id('party')), false)) s;
select from (select test.act_as(test.id('carol'))) s;
select from (select public.join_game(current_setting('test.code'))) s;
reset role;
select from (select test.act_as(test.id('bob'))) s;
select test.expect_error($$select public.start_game(test.id('party'))$$, 'at least two players');
reset role;
select from (select test.act_as(test.id('dave'))) s;
select from (select public.join_game(current_setting('test.code'))) s;
reset role;
select from (select test.act_as(test.id('bob'))) s;
select from (select public.start_game(test.id('party'))) s;
select test.eq((public.get_game_state(test.id('party')) #>> '{round,target,lat}') is not null, true, 'host screen sees the target');
reset role;
select from (select test.act_as(test.id('carol'))) s;
select test.eq((public.get_game_state(test.id('party')) #>> '{round,target,lat}') is null, true, 'phones do not get the target during the round');
select from (select public.submit_guess(test.id('party'), 51.5, -0.2)) s;
select test.expect_error($$select public.end_round(test.id('party'))$$, 'Only the host');
reset role;
select from (select test.act_as(test.id('bob'))) s;
select test.expect_error($$select public.submit_guess(test.id('party'), 0, 0)$$, 'not in this game');
select from (select public.end_round(test.id('party'))) s;
select test.eq(public.get_game_state(test.id('party')) #>> '{round,status}', 'results', 'host can end the round early');
select test.eq(jsonb_array_length(public.get_game_state(test.id('party')) -> 'guesses'), 1, 'player who didn''t guess has no guess (scores 0)');
select from (select public.next_round(test.id('party'))) s;
reset role;
select from (select test.act_as(test.id('dave'))) s;
select test.eq(public.get_game_state(test.id('party')) #>> '{round,number}', '2', 'phones move to round 2');
reset role;

-- ---------- Realtime channels ----------

select test.eq((select count(*) from realtime.messages where topic = 'game:' || test.id('party')) > 0, true, 'game events broadcast');
select from (select set_config('realtime.topic', 'game:' || test.id('party'), false)) s;
select from (select test.act_as(test.id('carol'))) s;
select test.eq((select count(*) from realtime.messages) > 0, true, 'member receives game events');
reset role;
select from (select set_config('realtime.topic', 'game:' || test.id('solo'), false)) s;
select from (select test.act_as(test.id('carol'))) s;
select test.eq((select count(*) from realtime.messages), 0::bigint, 'outsider receives no game events');
reset role;
select from (select set_config('realtime.topic', 'not-a-game', false)) s;
select from (select test.act_as(test.id('carol'))) s;
select test.eq((select count(*) from realtime.messages), 0::bigint, 'bad topic receives nothing');
reset role;

-- ---------- Admin ----------

select from (select test.act_as(test.id('admin'))) s;
select test.eq((select count(*) from public.locations), 10::bigint, 'admin reads locations');
select test.eq((select count(*) from public.rounds) >= 15, true, 'admin reads all rounds');
select test.eq((select count(*) from public.games), 4::bigint, 'admin reads all games (one cancelled)');
select test.eq((select count(*) from public.profiles), 4::bigint, 'admin reads all profiles');
insert into public.maps (id, name) values ('11111111-1111-1111-1111-111111111111', 'Admin map');
insert into public.locations (map_id, name, round_number, lat, lng) values ('11111111-1111-1111-1111-111111111111', 'Somewhere', 1, 10, 10);
update public.maps set active = false where id = '11111111-1111-1111-1111-111111111111';
select test.expect_error($$update public.games set status = 'complete'$$, 'permission denied');
reset role;
select from (select test.act_as(test.id('bob'))) s;
select test.eq((select count(*) from public.maps), 2::bigint, 'players don''t see inactive maps');
select test.expect_error($$select public.create_game('single_player', '11111111-1111-1111-1111-111111111111')$$, 'isn''t available');
delete from public.maps;
reset role;
select test.eq((select count(*) from public.maps), 3::bigint, 'player delete removed nothing');

-- ---------- History and leaderboard ----------

select from (select test.act_as(test.id('bob'))) s;
select test.eq(jsonb_array_length(public.my_games()), 3, 'my games lists played and hosted games');
select test.eq(jsonb_array_length((select g -> 'places' from jsonb_array_elements(public.my_games()) g where g ->> 'id' = test.id('solo')::text)), 5, 'my games has the five places of a finished game');
select test.eq(public.leaderboard() #>> '{0,name}', 'Bobby', 'leaderboard ranks completed games');
select test.eq((public.leaderboard() #>> '{0,games}')::int, 1, 'only completed games count');
reset role;

\echo 'All GeoBarkr SQL tests passed.'
