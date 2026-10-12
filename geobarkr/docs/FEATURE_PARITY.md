# GeoBarkr: feature parity (ServiceNow → gabarker.com/geobarkr)

Phase 1 inventory of the ServiceNow app in `gabarker01/geobarkr`, and how each
piece will be rebuilt as a standalone web app. Nothing here is built yet; every
row is **Planned** until Phase 3 updates it.

## Source at a glance

The source repo is four ServiceNow update-set exports (no loose code). Each set
builds on the one before:

| Update set | Exported | What it added |
|---|---|---|
| `GeoBarkr 1.0.xml` | 2026-01-14 | Scoped app `x_1119993_geobarkr`: tables, single player, Service Portal `/geobarkr`, theme, header, logo/icon |
| `GeoBarkr 2 - Multiplayer.xml` | 2026-01-31 | Game type, online multiplayer (lobby, live guesses, round results), demo map + 5 locations |
| `GeoBarkr 3 - Local Multiplayer.xml` | 2026-02-10 | In-person mode (QR join, phone map, host screen, sound), server-side scoring business rule, multiplayer results table |
| `GeoBarkr - Global Files.xml` | 2026-02-10 | One attachment: `LEGO® Minikit Sound Effect.mp3` (played on the host screen when a guess comes in) |

The latest version of each record (set 3, else 2, else 1) is treated as the
source of truth. Earlier versions are only mentioned where behaviour changed.

Record counts: 6 tables, 40 dictionary fields, 2 script includes, 1 business
rule, 15 portal widgets (+1 cloned header), 10 portal pages, 1 record
producer with 4 variables and 4 catalog UI policies, 25 ACLs, 1 role, 7
backend modules, 1 map and 5 locations of seed data.

**Not present in the source:** scheduled jobs, REST APIs (all server calls are
GlideAjax), UI actions, classic client scripts, UI pages, notifications, a
countdown timer, a global leaderboard or a game history page. The `Password
Reset Process` and the `sn_irm_*` / `taxonomy.*` system properties in the
exports are instance noise, not part of the game.

---

## 1. Data model

### Tables

All tables are in scope `x_1119993_geobarkr`. Every table also has the
ServiceNow system fields (`sys_id`, `sys_created_on`, `sys_created_by`, …),
and `sys_created_by` is used by the game (it identifies a game's owner/host).

| Table (label) | Number prefix | Fields | Relationships |
|---|---|---|---|
| `_map` (Map) | `MAP` | `name` (string), `active` (bool, default true) | has many Locations, has many Games |
| `_location` (GeoBarkr Location) | `GEOLCN` | `name`, `lat`, `lng`, `heading`, `pitch` (all **strings**, default `0`), `u_round_number` (choice 1–5, default 1), `map` | belongs to Map |
| `_game` (Game) | `GAME` | `status` (choice), `type` (choice, default `single_player`), `map` | belongs to Map; has many Rounds, Game Players |
| `_game_player` (Game Player) | `PLAY` | `player` (→ `sys_user`), `game`, `total_score` (int), `total_distance` (int) | joins a user to a game; has many Guesses |
| `_round` (Round) | `RND` | `round_number` (int), `status` (choice, default 1), `location`, `game`, `round_started`, `round_ended` (date-times) | belongs to Game and Location; has many Guesses |
| `_guess` (Guess) | `GUES` | `round`, `player` (→ Game Player), `lat`, `lon`, `distance` (string, km), `score` (string), `guess_time` (duration) | belongs to Round and Game Player |

### Choice lists

| Field | Values |
|---|---|
| Game `status` | `1` Lobby · `2` In Play · `3` Complete · `4` Cancelled (never set by any code) |
| Game `type` | `single_player` · `multiplayer` · `local_multiplayer` (labelled "coming soon!" in set 2, live in set 3) |
| Round `status` | `1` Ready · `2` In Progress · `21` Results (added in set 2) · `3` Complete |
| Location `u_round_number` | `1`–`5` |

### Seed data (set 2)

Map **GeoBarkr Demo** (`MAP0001002`, active), five locations:

| Round | Name | Lat | Lng | Heading | Pitch |
|---|---|---|---|---|---|
| 1 | 4 Medley Road | 51.54713683719802 | -0.1947690014365771 | 120 | 0 |
| 2 | Calitii | 51.5160261988762 | -0.12549442205816058 | 200 | 0 |
| 3 | Eiffel Tower | 48.859 | 2.296 | 250 | 0 |
| 4 | Sydney harbour | -33.8524678 | 151.2105238 | 0 | 0 |
| 5 | CopaCobana | -22.9682017 | -43.1797941 | 244.26 | 0 |

(Location numbers start at `GEOLCN0001003`, so two earlier locations were
deleted before export. Calitii's longitude has a stray leading space in the
source; the port trims it.)

### Web app plan

Postgres tables with the same shape and real types (`double precision` for
coordinates, `integer` scores, `interval` or milliseconds for time, enums for
statuses), UUID keys, and `created_by` in place of `sys_created_by`. A
`profiles` table replaces `sys_user` (display name, role). The `number`
fields become a short human **room code** on games (needed for party mode);
other auto-numbers are dropped (UUIDs are enough, and admin pages can show
names instead). A seed SQL file ports the demo map and its five locations
exactly. Full SQL comes in Phase 2.

---

## 2. Server logic

### `GeoBarkrUtils` (script include, server only)

| Function | What it does | Web app |
|---|---|---|
| `calculateDistanceBetweenPoints(lng1, lat1, lng2, lat2)` | Haversine, R = 6371 km. Rounds to the nearest km at ≥ 10 km, else to 0.1 km. Returns a string | Same formula in a Postgres function; same rounding |
| `calculateScoreFromDistance(km)` | `5000 × e^(−metres / 2,000,000)` (i.e. `5000 × e^(−km / 2000)`), rounded; full 5000 under 10 m | Same formula, in Postgres |
| `generatePlayers(game, users[])` | Adds Game Player rows (totals 0) if the game is Lobby or In Play | `join_game` RPC |
| `generateRounds(game, launch)` | One round per location in the game's map, `round_number` = location's round number; if `launch`, round 1 starts immediately | Part of `create_game` RPC |
| `getCurrentViewfromGame(game)` | Location (lat, lng, heading, pitch) of the round in status 2 or 21 | `current_round` RPC (only returns the target to those allowed to see it, see §6) |
| `nextRound(game)` | Completes the current round (sets `round_ended`), starts round n+1 (`round_started` = now) | `next_round` RPC |
| `createGuess(game, user, distance, lat, lng)` | Inserts a guess on the in-progress round; `guess_time` = now − `round_started` | `submit_guess` RPC; **distance is computed on the server** (the source trusted a client-sent distance) |
| `checkIfNextRound(game, multiplayer)` | Is there a Ready round (single) / Ready or In Progress round (multi) | Folded into `next_round` / client state |
| `getUserGameGuesses(game, user)` | The user's guesses with round number, distance, score, formatted time, guess and target coordinates | Query used by the scorecard page |
| `getGamePlayers(game)` | Name, join time, username, user id per player | Query + Realtime on the lobby |
| `startMultiGame(game)` | Game → In Play, round 1 → In Progress | `start_game` RPC (host only) |
| `getRoundGuesses(game)` | Guesses on the current round: player, name, lat/lng, formatted time, distance, score | Query + Realtime |
| `getCurrentRoundID`, `getRoundNumber`, `getLocFromRound` | Helpers | Folded into `current_round` |
| `sendRoundtoResults(round)` | Round → status 21 (Results) | Done automatically inside `submit_guess` when the last player guesses |
| `completeGame(game)` | Game → Complete; every unfinished round → Complete | `complete_game` RPC |
| `getGameSummary(game)` | Per player: score, distance and time for each round plus totals; sorted by total score, highest first | Query/view for the multiplayer results page |
| `_checkValidGame`, `_getGamePlayer`, `_formatTimeField` | Game is Lobby/In Play; user's Game Player; time as `Xmin Ys` or `Ys` | Same checks in RPCs; same time format in the client |

### `geoBarkrAjax` (client-callable script include)

GlideAjax wrapper exposing `getDistanceFromLongLats`, `getViewDetailsFromGame`,
`nextRound`, `createGuess`, `checkIfNextRound`, `getUserGameGuesses`,
`startMultiGame`, `completeGame`, `addPlayerToGame`. Uses `gs.getUserID()` for
the caller except `addPlayerToGame`, which takes the user id from the request
(any user could add anyone). **Web app:** Supabase RPCs (Postgres functions)
that always use `auth.uid()`.

### Business rule: **Calculate Score for Guess** (set 3)

Before insert on Guess: computes `score` from `distance`, then adds the
distance and score to the Game Player's `total_distance` and `total_score`.
**Web app:** the same work inside `submit_guess` (or a trigger).

Before set 3 nothing ever wrote a score, so single-player and multiplayer
games in sets 1–2 had blank scores. The port uses the set 3 behaviour
everywhere.

---

## 3. Roles, ACLs and the logged-in user

| Source | Detail | Web app |
|---|---|---|
| Role `x_geobarkr.user` | Required for every table ACL and the GlideAjax ACL. Grants **create/read/write/delete on all six tables** | App role **player** (default for every signed-in user) |
| ServiceNow `admin` | `admin_overrides = true` on every ACL; backend modules for managing data | App role **admin** |
| Role `x_1119993_geogue_0.user` | Leftover from an earlier app, also allowed on the GlideAjax ACL | Dropped |
| ACL on one `sys_attachment` | Lets users read the sound effect file | Sound becomes a static file |
| Portal pages | All `public = false`: login required | Login required on every page (Supabase Auth) |
| Logged-in user usage | Player identity for guesses and joins; display name on the scorecard ("{name}'s Scorecard") and first name in phone messages ("Cheers {first name}!"); game **owner** = `sys_created_by` (only the owner can start a game and advance rounds; marked "owner" in the lobby) | `auth.uid()`, `profiles.display_name`, `games.created_by` |

**Tightening (not a gameplay change):** in ServiceNow any player could read
and edit every row, including other players' guesses and the maps. The web
app enforces with row-level security: players see games they are in, can
only write their own guesses through RPCs, and only admins can edit maps and
locations. Details in Phase 2.

---

## 4. Pages and features

Portal: **GeoBarkr** at `/geobarkr` (homepage `geobarkr_home`), theme "GeoBarkr
Theme", logo + pin icon, fixed navbar and footer.

| # | Feature | ServiceNow source | Web app (planned route / approach) |
|---|---|---|---|
| 4.1 | Branding | Portal logo (919×272 PNG "GeoBarkr" red outline with pin) and icon (red pin), red `#cc0000` buttons darkening to `#800000`, light grey `#f4f6f9` page, white cards with 16px radius | Same logo/icon files ported to `/geobarkr/assets/`, same colour scheme |
| 4.2 | Header | Widget **GeoBarkr Header** (clone of the stock Polaris header): logo linking home, user menu (profile / log out), mobile hamburger | Slim header: logo → home, signed-in name, sign out. No search/cart/to-dos (unused stock features) |
| 4.3 | Footer text | "Created by George Barker 2026" under the map | Same |
| 4.4 | Home | Page `geobarkr_home` → widget **Redirect to New Game** sends straight to the Start Game form | `/geobarkr/` is the Start Game screen (after sign-in) |
| 4.5 | Start Game form | Record producer **Start Game** (`sc_cat_item`): "How to play" text; **Select game type** (default Single player); **Start new game or join existing** (multiplayer only); **Select map** (active maps only; shown for new games); **Select existing game to join lobby** (games in Lobby status, showing creator and map). Catalog UI policies show/hide these per type | `/geobarkr/` form with the same fields and show/hide rules, same "How to play" copy |
| 4.6 | Start single player | Producer script: game In Play, player + rounds created, round 1 started → `play` page | `create_game` RPC → `/geobarkr/play/?game=…` |
| 4.7 | Street View panorama | Widget **GeoBarkr Panorama**: Google `StreetViewPanorama` at the round's lat/lng/heading/pitch; movement arrows, address, road labels, zoom buttons and close button hidden; pan control on (users can still drag, click-to-move and pinch/scroll zoom) | Same options. Full-width on phones |
| 4.8 | Return to start | Red **home button** on the panorama resets position and view to the start | Same, large touch target |
| 4.9 | Guess map | Widget **GeoBarkr Map**: Google map, zoom 1, min zoom 1, centred 21.17, −6.81, latitudes clamped to ±80, no map-type or Pegman controls; click places/moves a single marker; red **Guess** button | Same map settings. Tap to place/move the marker; Guess button |
| 4.10 | Map enlarges on hover | CSS `#map:hover` grows the map (desktop only) | **Hover-only, so replaced:** an expand/collapse button, and on phones the map is a bottom sheet that can be opened full-height. Pinch/drag work natively |
| 4.11 | Round result (single) | Widget **GeoBarkr Results Popup**: overlay map with guess marker, green tick-pin target marker, red geodesic line, "You were X km away", **Continue** | Same overlay. See question Q2 about also showing the score |
| 4.12 | Next round / finish (single) | Continue → `checkIfNextRound` → `nextRound` (page reloads) or `completeGame` → results page | Same flow without page reloads |
| 4.13 | Single-player results | Page `geobarkr_results_single` → widget **single player results table**: map of all guesses, targets and lines; "{name}'s Scorecard" table (Round, Distance to Target (km), Time, Score) with a Total row; **Play Again** → Start Game | `/geobarkr/results/?game=…` with the same map and table |
| 4.14 | Create online lobby | Type Multiplayer + "Start a new game": game in Lobby, creator added as a player, rounds created (not started) → `lobby` | `create_game` → `/geobarkr/lobby/?game=…` |
| 4.15 | Join online lobby | Type Multiplayer + "Join an existing game": pick from all Lobby games → added as player → `lobby` | Same picker of open lobbies; see Q4 about also accepting the room code |
| 4.16 | Lobby | Page `lobby` → widget **GeoBarkr Lobby players**: "Game Lobby"; "Players for GAME…" list with join time and an **owner** badge; info table (Game Type, Map, Rounds = 5, Players); **Start Game** button only for the owner and only with **more than one player**; live updates via `recordWatch`; everyone is sent to the play page when the game starts | Same, live via Supabase Realtime |
| 4.17 | Online play | Page `playmulti`: Panorama + **Map Multiplayer** + **Multiplayer Results Popup**. After guessing, the map is replaced by "Guesses this round" (Player, Time; live). Reloading keeps state (already guessed → list shown) | `/geobarkr/play/?game=…` in multiplayer mode, same behaviour |
| 4.18 | Round completes when everyone has guessed | Server marks the round Results (21) when guesses = players | Inside `submit_guess`, broadcast via Realtime |
| 4.19 | Round results (multi) | "Round Results" overlay map: green target, every player's marker + red line + an info window "{name} · X km • N pts"; **Next Round** (or **Results** on round 5) only for the owner | Same. Info windows become always-visible labels (tap-friendly) |
| 4.20 | Advancing everyone | Owner clicks → `nextRound` / `completeGame`; other clients watch the next round / game record and reload or go to results | Realtime subscription; no reloads |
| 4.21 | Multiplayer results | Page `geobarkr_results_multi` → widget **Results Table Multiplayer**: "Game Results", header (map, type, date), table Player × Round 1–5 (score, "distance • time") + TOTAL, sorted by total score; **Play Again** | `/geobarkr/results/?game=…` (multi layout), sorted the same |
| 4.22 | Create in-person game | Type Local multiplayer: game in Lobby, rounds created, **host is not a player** → lobby with `type=local_multiplayer` | Same; host screen at `/geobarkr/host/?game=…` |
| 4.23 | QR code to join | Lobby shows "Scan QR code to join game on mobile" using `api.qrserver.com` (third-party image) of `…/geobarkr?id=join_local&game=…` | QR drawn in the browser (no third party) + a short **room code** to type at `/geobarkr/join/` |
| 4.24 | Join on phone | Page `join_local` → widget **Join Local Game**: opening the link adds the signed-in user; "Welcome {name}, you're in!" + How to play (5 rounds, use the Street View, tap the map, closer = more points, you'll be redirected automatically); moves to the phone map when the game starts | `/geobarkr/join/?code=…` with the same copy. Signing in first returns to the join link |
| 4.25 | Host screen during a round | Page `play_localmulti`: big Street View (Panorama) + **In Play Local Guesses** ("Guesses this round": Player, Time; live) + the round results overlay; plays the sound effect on each new guess | Same on `/geobarkr/host/` (see Q6 about the sound file) |
| 4.26 | Phone during a round | Page `map_mobile` → widget **Map Mobile**: "Round N / 5", full-width map, **Guess** disabled until the map is tapped; phones do **not** show Street View (players look at the host screen) | `/geobarkr/party/?game=…`; same. The target location is never sent to phones (source sent it) |
| 4.27 | Phone after guessing | Card "Cheers {first name}! Your guess has been locked in. Waiting for the other players…" | Same |
| 4.28 | Phone after the round | Card "Round Complete — You scored N points this round and were X km away. You will be redirected to the next round shortly…"; reloads when the host starts the next round | Same, via Realtime |
| 4.29 | Host results and end | Host sees the round results overlay and the owner buttons; on the last round → multiplayer results table (the leaderboard). Phones go to their own single-player scorecard | Same |
| 4.30 | Backend admin | Application menu **GeoBarkr** with list/form modules for Games, Maps, GeoBarkr Locations, Game Players, Rounds, Guess, and a link to the portal. Forms: Location (number, name, map, round number / lat, lng, heading, pitch), Map (name, active) + related Locations and Games, Game + related Rounds and Players, Round + related Guesses | `/geobarkr/admin/` (admin role only): manage maps (name, active) and their locations (name, round 1–5, lat/lng/heading/pitch, with a Street View preview to check the view), and read-only lists of games, players, rounds and guesses |

---

## 5. External services and keys

| Service | Source usage | Web app |
|---|---|---|
| Google Maps JavaScript API (Maps + Street View) | Loaded by 7 widgets with the key **hard-coded in client code** | Same API, one loader. Key in a public config file, restricted in Google Cloud to HTTP referrers `https://gabarker.com/geobarkr/*` and to the Maps JavaScript API only |
| `api.qrserver.com` | QR image for the join link | Replaced by a small QR library loaded from a CDN (nothing sent to a third party) |
| Geocoding | Not used | Not needed |

**Security note:** the Google Maps key in the source repo
(`AIzaSyAnVm…`) is public in GitHub. Unless it is already restricted to your
ServiceNow instance's referrer, I recommend restricting or rotating it in
Google Cloud. The web app will use a new key restricted to gabarker.com, not
that one.

---

## 6. Gaps, bugs and ambiguities

### Source bugs the port fixes (no gameplay change)

- **Page reload hacks.** The play pages force a one-time reload to get
  Street View to load (`playPageRefreshed`). Not needed.
- **Guess with no marker.** On desktop, Guess with no marker placed throws
  an error. The phone version disables the button until you tap the map; the
  port does that everywhere.
- **Client-trusted distance.** The browser computed the distance and sent it
  with the guess, so a player could send any score. The server will compute
  it.
- **Target leaked to phones.** In-person phones were sent the target
  coordinates. The port only reveals the target after the round ends.
- **Distance after reload.** The phone "Round Complete" card used a value
  that is lost after a reload; the port reads the guess back from the server.
- **Lobby redirect check.** The lobby's "game started" check compares status
  to `1` (Lobby) rather than `2`. It only worked because of page refreshes.
  The port redirects when the game becomes In Play.
- **Anyone can add anyone.** `addPlayerToGame` took the user id from the
  browser. The port only lets you join as yourself.

### Behaviours kept as-is unless you say otherwise

- **Exactly 5 rounds.** Rounds come from the map's locations (round numbers
  1–5). The lobby shows "Rounds: 5" and the results table has five round
  columns, both hard-coded.
- **Lenient scoring curve.** 5000 × e^(−km/2000): 100 km ≈ 4756, 1000 km ≈
  3033, 5000 km ≈ 410. This is the set 3 formula, kept exactly.
- **Total distance stored as a whole number** (the field is an integer
  column), while round distances keep 0.1 km precision under 10 km. The port
  stores the precise total and **shows** it rounded the same way.
- **No time limit.** "Time" is how long each guess took (round start → guess).
  There is no countdown and no time-based scoring.
- **Starting needs at least 2 players** (online: the owner and one other; in
  person: two phones, since the host isn't a player).
- **The owner/host alone advances rounds.**
- **Cancelled status** exists but nothing sets it.

### Questions for you (gameplay judgment calls)

- **Q1. Player who drops out.** A round only ends when *every* player has
  guessed, so one player leaving freezes the game for everyone. Keep exactly
  that, or add a host-only "End round now" button (unguessed players score 0
  for that round)?
- **Q2. Score in single player.** The single-player round popup shows only
  "You were X km away" (score appears on the final scorecard). Keep, or also
  show the round's points like multiplayer does?
- **Q3. Joining a game in progress.** The source lets someone join (via the
  QR link) after the game has started, which then makes the current round
  wait for them. Keep, or only allow joining while in the lobby?
- **Q4. Online multiplayer joining.** The source lists all open lobbies,
  including in-person ones (anyone signed in can join any of them). Keep the
  list, use room codes only, or both (list online lobbies only + code)?
- **Q5. History and leaderboards.** The source has per-game results only
  (plus the admin lists). Should I add a "My games" history page and/or an
  all-time leaderboard, or keep to the source?
- **Q6. Sound effect.** The source plays `LEGO® Minikit Sound Effect.mp3` on
  the host screen. It's LEGO's audio, and publishing it on gabarker.com could
  be a copyright problem. Port it as-is, replace it with a similar free/
  generated chime, or leave it out?
- **Q7. Maps provider.** I plan to keep Google Maps + Street View (the game is
  built on Street View imagery). It is pay-as-you-go beyond the monthly free
  usage, so I'll set it up with quotas. OK?

### Notes for Phase 2 (architecture, not gameplay)

- **Supabase isolation.** This repo already uses a Supabase project
  (`qmgwlvjvwwrlcuupsttb`) for TapMap/Bearings, with its own `games`,
  `locations` and `profiles` tables. To keep that untouched, GeoBarkr will get
  a **new, separate Supabase project** and its own config file; no TapMap
  file or table changes. Supabase's free plan allows two active free
  projects, so this uses your second one. Details in Phase 2.
- **Which branch the site deploys from.** The repo's default branch is
  `claude/placeholder-website-264jmx` (where Bearings went live) and `main` is
  29 commits behind it. I'll confirm with you which one Pages serves before
  opening the PR in Phase 3.
- **Routes.** Every page will be a real folder (`/geobarkr/play/`,
  `/geobarkr/lobby/`, …), so the shared `404.html` used by TapMap does not
  need to change.

---

## Status key

Phase 3 will add a status to every row in §4: **Done**, **Done (changed)**
with the reason, or **Not done** with the reason.
