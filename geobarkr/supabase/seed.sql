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
