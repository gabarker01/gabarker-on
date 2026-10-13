# GeoBarkr: design (Midnight)

Made with the `frontend-design` skill: a plan, a review of the plan against
generic defaults, then the build. The notes at the end record what was tried
and rejected, for later passes.

## Brief

- **Subject:** GeoBarkr, a Street View guessing game. You're dropped
  somewhere in the world, look around, and tap a map where you think you are.
- **Audience:** friends and family, mostly on phones. In person, one laptop or
  TV shows Street View to the room while everyone guesses on their phone.
- **Primary job:** get people into a round in seconds, then make the reveal
  (where it was, how far off everyone was, the points) the moment everyone
  looks up for.
- **Constraints:** most of the screen on game pages is real Google imagery
  (Street View photos, the map), so the interface must sit well on top of
  photos of any colour. It should be light (no framework, one font), dark and
  look made by a person, not generated. It keeps the name but drops the
  ServiceNow red road-sign look.

## Plan

**Idea: a night chart.** The game is about where on Earth you are, so the
interface is a navigator's chart at night: deep navy water, slightly lighter
land, a faint graticule, and lines that are true great-circle routes. Your own
pin is the one warm thing on the chart (ember), so you always find yourself
first. Everything else stays cool and quiet so Street View carries the colour.

**Colour** (tokens in `css/geobarkr.css`)

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0B1426` | Page ground, top bars, sheets over the map |
| `--surface` | `#111D35` | Cards, rows, inputs |
| `--line` | `#1F2E4D` | Borders and rules |
| `--text` / `--muted` | `#E6EEFA` / `#8597B5` | Text |
| `--primary` | `#7CC4FF` (ink `#06101F`) | Buttons, links, focus, the room-code tail |
| `--me` | `#FF8A5B` | Your pin, your line, your score. Used for nothing else |
| `--water` / `--land` / `--coast` | `#0A1324` / `#1B2A47` / `#2A3D63` | Drawn world maps and the Google map style |

Other players get colours from a fixed palette in the order they joined
(`js/players.js`), so a player is the same colour on every screen of a game.

**Type:** Instrument Sans (one Google Font, weights 400 to 700). Tight
negative tracking on headings, tabular figures for every score, distance,
time and room code. Sentence case everywhere.

**Maps**

- Google Maps uses a dark style in the same colours (`js/maps.js`), with
  businesses and transit hidden so labels don't give places away.
- Pins are players' avatars (Google photo, or initials in their colour) in a
  ring of their colour, drawn as HTML overlays. The target is a white
  crosshair with the place name once the round is revealed.
- Results lines are geodesic (great-circle) polylines in each player's colour.
- Pages without Google Maps (landing, lobby, join, results, my games,
  leaderboard, sign in) carry a **map band**: a drawn Web Mercator world map
  (`js/worldmap.js`, land from `/tapmap/land-110m.geojson`) showing something
  real: your last game's routes on the landing page, the rounds of a game on
  its results, every place you've played on My games, small route thumbnails
  on each game row.

**Layout**

- **Landing:** map band with your last game and its score, then map choice,
  the three modes as rows (tap one to start), and the join form.
- **Play (phone):** Street View full-bleed; a bottom sheet with the guess map
  that expands, the coordinates of your pin, and Guess. The round reveal is
  a full-screen sheet: map with lines, place name, ranked players.
- **Host (laptop/TV):** Street View large, a side panel with live guesses as
  avatars arrive, sound on each guess, End round.
- **Party (phone):** just the map and Guess, then a status card.
- **Lobby:** a room-code card with the QR, the code in large tabular
  figures, the player list with avatars, Start for the owner.

## Review against defaults

- *Purple gradient, glassmorphism, emoji icons, "AI startup" hero?* None. Flat
  navy surfaces, 1px rules, no gradients except the map's own shading.
- *Generic blue SaaS?* The blue is a pale glacier blue on near-black navy, and
  the one warm accent is reserved for "you", so colour carries meaning.
- *Decoration for its own sake?* Every map band shows the player's own data
  (before your first game, the landing band is just the chart and a welcome).
- *Works on real imagery?* The top bar and sheet are solid `--bg`, not
  translucent, so they read the same over snow, sea or a city at night.
- *Light enough?* One font, one stylesheet, inline SVG logo, no framework.

## Notes

- Tried before settling: a road-sign look (the ServiceNow port), "Sodium"
  (amber street-light), "Passport" (paper and stamps) and a 3D globe
  ("Graticule"). The flat graticule won; among its colour schemes Midnight
  (C1) was picked over Graphite, Deep sea and Dusk, and two heavier redesigns
  of it were rejected in favour of adding the map bands.
- Date-line shapes in the land data are unwrapped rather than dropped
  (dropping them deletes Eurasia). Antarctica is left out of the bands.
- Great-circle points are generated with continuous longitudes so arcs that
  cross the date line draw as one line.
