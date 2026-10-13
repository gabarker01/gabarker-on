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

-- A second map with five far-apart, well-covered Street View spots.
insert into public.maps (id, name, active)
values ('6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01', 'World tour', true)
on conflict (id) do nothing;

insert into public.locations (id, map_id, name, round_number, lat, lng, heading, pitch) values
  ('6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a11', '6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01', 'Times Square, New York', 1, 40.7580, -73.9855, 30, 0),
  ('6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a12', '6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01', 'Shibuya, Tokyo', 2, 35.6595, 139.7005, 60, 0),
  ('6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a13', '6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01', 'V&A Waterfront, Cape Town', 3, -33.9036, 18.4207, 200, 0),
  ('6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a14', '6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01', 'Laugavegur, Reykjavík', 4, 64.1455, -21.9300, 90, 0),
  ('6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a15', '6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01', 'Avenida 9 de Julio, Buenos Aires', 5, -34.6037, -58.3816, 0, 0)
on conflict (id) do nothing;
