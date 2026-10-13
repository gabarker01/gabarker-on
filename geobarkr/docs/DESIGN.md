# GeoBarkr: design (Fog)

> **Current: Fog (October 2026).** A light theme chosen from a round of
> mockups (F1 to H): cool grey paper `#F3F5F7`, white cards, ink-black buttons
> `#0E1726`, your colour ember `#F26A3D`, light map (water `#D3DEEA`, land
> `#F7F8FA`). Other players get saturated colours that read on white.
>
> - **Start:** your places pinned on a world map; a Resume strip for a game in
>   progress; Solo / Friends / Party as one switch, so Play is always the same
>   button; map picker; room code as one row.
> - **Play:** Street View fills the screen. The map is a bubble in the corner;
>   tap it and it grows into a card. Shrink it again and it shows your pin up
>   close, with Guess beside it. After guessing (with friends) the card shows
>   who has guessed. The host's End round now floats under the top bar.
> - **Reveal:** the map fills the screen with everyone's lines; a card shows
>   your distance, points, time and place this round, then a row per player
>   with distance, time, a score bar and points.
> - **Lobby:** one card with the QR, the room code and Share invite link.
> - **Game results:** the winner as the headline; your points, distance off
>   (total and per round), closest round and time (total, per round,
>   fastest); standings with each player's distance, time and a per-round
>   strip; then every round with everyone's distance, time and points.
> - **How to play:** a ? button beside your picture (and on the game screens)
>   opens a short guide with the scoring table.
>
> **Profile and map maker (added October 2026).**
>
> - **Your picture** in the header opens your profile: your places on a band,
>   eight number tiles (games, points, average, wins, distance, closest,
>   time, perfect rounds), your maps as cards, then grouped rows (name, My
>   games, Leaderboard, Admin, About) and Sign out. On wide screens the page
>   links also sit in the header.
> - **Map kinds** are shown everywhere maps are listed: a blue walker for
>   Street View, an ember picture for Photos. The picker has chips (All,
>   Street View, Photos, Yours) and says who made a map.
> - **Map maker:** two big cards to choose the kind, then the map page: a
>   readiness card (five bars fill as places are added, green when ready,
>   with Play), five place slots, and details in an iOS-style group that saves
>   as you type. Each place opens a full-screen editor (a large panel on
>   desktop): Street View or the photo on top with search floating over it,
>   the map below, then the place name.
> - **Photo rounds:** the whole photo, centred, on a blurred and frosted copy
>   of itself, so landscape photos get glass above and below and portrait
>   ones at the sides. Pinch, drag, double-tap or scroll to zoom, with
>   rubber-banding at the edges and springs on release; the recentre button
>   zooms back out. The compass is hidden.
>
> The Midnight notes below are kept for history; the interaction principles
> (springs, press feedback, reduced motion) still apply.

# Previous: Midnight

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
- *Works on real imagery?* Over Street View the top bar is frosted (dark
  tint plus blur), so it reads the same over snow, sea or a city at night;
  the guess sheet is solid.
- *Light enough?* One font, one stylesheet, inline SVG logo, no framework.

## Interaction

A second pass using the `apple-design` skill (Apple's "Designing Fluid
Interfaces", translated for the web). The look stayed; the feel changed.

- **Respond on press.** Buttons scale to 0.97 the moment they're pressed,
  rows highlight on touch-down, and `touch-action: manipulation` removes the
  tap delay. Hover styles only apply on devices that hover.
- **The guess sheet (phones) is a physical object** (`js/sheet.js`): drag its
  top edge and it follows 1:1 from where you grabbed it; release and it
  springs to the size you were heading for, using Apple's momentum
  projection (a flick throws it), with your finger's speed handed to the
  spring. It can be caught mid-flight. Past the smallest or largest size it
  rubber-bands. A tap on the edge, or the expand button, toggles it.
- **Springs, not timed animations, for anything you touch** (`js/motion.js`):
  critically damped by default; a little bounce only after a flick.
- **The one orchestrated moment is the reveal.** Round results rise as a
  sheet from where you guessed (phones) or grow out of the guess panel
  (desktop), and your distance and points count up.
- **Motion that answers you:** your pin drops in where you tap, with a
  haptic tick on Android; a player who joins the lobby or guesses slides in
  and glows briefly; the leaderboard's segmented control slides to your
  choice; the menu grows out of your avatar and returns into it (Escape
  closes it).
- **Materials:** the top bar over Street View, the recentre and expand
  buttons and the menu are frosted; page headers gain their frosted backing
  only once content scrolls under them, with a soft edge instead of a rule.
- **Type:** sizes in `rem` so the reader's text size setting is respected;
  negative tracking on large headings, a touch of positive tracking on small
  labels.
- **Accessibility:** reduced motion swaps slides and springs for short fades;
  reduced transparency and increased contrast make the bars solid with
  clearer edges.
- **Tried and dropped:** cross-page view transitions. They looked smooth but
  swallowed taps for the first ~0.4 s on each page, which breaks "never lock
  out input during a transition".

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
