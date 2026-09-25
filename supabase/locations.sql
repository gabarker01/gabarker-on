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
