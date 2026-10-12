# GeoBarkr: design plan

Made with the `frontend-design` skill: a short plan, a review of the plan
against generic defaults, then the build. Notes at the end record what was
tried, for later passes.

## Brief

- **Subject:** GeoBarkr, George's Street View guessing game. You're dropped
  somewhere in the world, look around, and tap a map where you think you are.
- **Audience:** friends and family, mostly on phones; in person, one laptop or
  TV shows Street View to the room while everyone guesses on their phone.
- **Primary job:** get people into a round in seconds, then make the reveal
  (how far off you were, and the points) the moment everyone looks up for.
- **Fixed assets:** the ServiceNow logo (red #EE0000 outlined wordmark with a
  map pin) and the green tick-pin used for targets.

## Plan (first pass)

**Idea: road signs.** Geography games are about finding your way, and the
most familiar wayfinding objects are road signs: a green primary-route sign
with white lettering and yellow numbers, a fingerpost pointing at
destinations, a distance sign saying how far it is to Paris. GeoBarkr uses
that language at its three key moments and stays quiet everywhere else.

**Colour**

| Name | Hex | Use |
|---|---|---|
| Pin red | `#EE0000` (pressed `#B30000`) | The logo's red: primary buttons, your guess pin |
| Route green | `#005F35` | Signs: room code, mode chooser, round results; the target pin |
| Route yellow | `#FFD200` | Numbers on green signs (points, room code) |
| Ink | `#18212B` | Text |
| Map paper | `#EDF1EC` | Page ground: the pale grey-green of a printed map's land |
| White | `#FFFFFF` | Sign lettering and borders; working surfaces (forms, tables, maps) |

Muted text `#56636E`, rules `#D3DBD4`.

**Type:** Overpass, a Google Font based on Highway Gothic, the US road-sign
face: it reads as signage at large sizes and stays clear at small ones. One
family: 800 for sign lettering and headings, 600 for buttons and labels, 400
for text. Tabular figures for every score, distance and time. Scale (roughly
a 1.25 step): 14, 16, 20, 25, 32, and 56 for the room code. Sentence case
everywhere, as on UK road signs.

**Layout**

- Start page: logo, then a fingerpost: the three game types as sign blades
  pointing right (single player, multiplayer, in person). Picking one is
  "choosing your route". Map choice and the Start button sit under it. Join is
  its own short form: a room-code field shaped like a blank sign.

  ```
  [GeoBarkr logo]
  ┌──────────────────────────╲
  │ Single player             ╲     ← green blades; the chosen one is
  ├──────────────────────────╱       raised with a yellow edge
  │ Multiplayer              ╲
  ├──────────────────────────╱
  │ In person                ╲
  └──────────────────────────╱
  Map [GeoBarkr Demo ▾]
  [ Start game ]                     Join a game  [ A B C 1 2 3 ] [Join]
  ```

- Game screens: Street View is the whole screen, nothing decorative. Phone:
  Street View on top, map docked below with an expand button. Desktop: map
  docked bottom-right over Street View.

  ```
  phone                    desktop
  ┌────────────────┐       ┌──────────────────────────────┐
  │ Round 2 of 5   │       │ Round 2 of 5                 │
  │  street view   │       │        street view           │
  │ [⌂]            │       │                    ┌────────┐│
  ├────────────────┤       │ [⌂]                │  map   ││
  │      map    [⤢]│       │                    │ [Guess]││
  │ [   Guess    ] │       └────────────────────┴────────┘┘
  └────────────────┘
  ```

- The reveal: a distance sign over the results map, e.g. white "Target
  342 km" with "+3,033" in yellow. Multiplayer shows one sign row per player,
  sorted by distance, like the destinations stacked on a real sign.
- Lobby: the room code is a big route sign (yellow letters on green) with the
  QR beside it. Players are a plain list.
- Everything else (results tables, My games, leaderboard, admin) is plain:
  left-aligned text, right-aligned numbers, hairline rules, no cards.

**Principles**

1. Signs are for the moments that matter: choosing a game, sharing the code,
   seeing how far off you were. Nowhere else.
2. Street View and the map get the screen. Chrome stays small.
3. Plain words: "Start game", "Guess", "Next round", "See results".

## Review against generic defaults

| Default it could drift into | What I changed |
|---|---|
| The SaaS card kit: every block in a white rounded card with the same soft shadow (my first pass did exactly this, copied from ServiceNow) | Removed. Plain sections on the map-paper ground; only signs and working surfaces have edges, and their corners differ (signs 8px with an inset white border like real sign plates; inputs and buttons 10px; maps 14px) |
| Warm cream page with a serif display | Cool map-paper grey-green and one sans family |
| Tracked-out ALL-CAPS labels, monospace data labels | None: sentence case like UK signs; numbers in Overpass tabular figures |
| `→` on buttons and links | Fingerpost blades are drawn shapes, not arrows in text. Buttons say what they do |
| A big-number hero with a gradient | The hero is the fingerpost, which is also the form |
| Fade-in on every section | One motion: the results sign slides up when a round is revealed. The map expands when you tap the expand button |

## Notes for next time

- Tried first: the ServiceNow look (white cards, `rgba(0,0,0,.1)` shadows,
  16px radius everywhere). It read as a template; replaced with the sign
  system above.
- Contrast (checked): the first green, `#00703C` (UK sign green), only gave
  4.3:1 for yellow, so it was darkened to `#005F35`: white 7.8:1, yellow
  5.4:1. White on pin red is 4.5:1 (buttons are 16px+ semibold); ink on map
  paper 14.3:1; muted text 5.4:1. Focus rings are 3px yellow on green signs
  and 3px ink elsewhere.
