# TapMap accounts: Supabase setup

TapMap works without accounts. Once these steps are done, players can sign in
(Google, or a username and password), keep their stats across devices, follow
friends and see friends' scores for the day.

Project: `https://qmgwlvjvwwrlcuupsttb.supabase.co` (free tier).

## 1. Create the tables

Dashboard → **SQL Editor** → **New query** → paste the **entire contents** of
`setup.sql` (not its file name) → **Run**. On a phone, open the file on
GitHub, tap **⋯ → Copy raw file** (or open **Raw** and select all), then paste.

`setup.sql` is `schema.sql` followed by `locations.sql`. It creates
`profiles`, `follows`, `games`, `locations` (seeded with the 68 launch places)
and the `profile_stats` view, turns on row-level security, and adds a trigger
that gives every new user a profile. It is safe to run again.

## 2. Add the publishable key to the site

Dashboard → **Project Settings** → **API Keys** → copy the **publishable**
key (older projects call it the `anon` `public` key). Paste it into
`tapmap/config.js` as `SUPABASE_KEY`. This key is meant to be public.

Never put the **secret** / `service_role` key in the site.

## 3. Allow sign-in to return to the game

Dashboard → **Authentication** → **URL Configuration**:

- **Site URL:** `https://gabarker.com/tapmap/`
- **Redirect URLs:** add `https://gabarker.com/tapmap/`

## 4. Turn on sign-in methods

Dashboard → **Authentication** → **Sign In / Providers**.

### Username and password (uses the Email provider)

Players can create an account with just a username and password. Supabase
needs an email per account, so each username is stored with a private
placeholder address (`username@players.gabarker.com`) that never receives mail.

- **Required: turn off "Confirm email"** (Authentication → Sign In / Providers
  → Email → Confirm email → off → Save). Otherwise Supabase tries to email the
  placeholder address and the account can't sign in.
- Keep the Email provider itself **enabled**; it's what handles passwords.
- There's no password reset for username accounts (no real email). The
  username can't be changed either, since it's the sign-in name; the display
  name can.

**Run `setup.sql` again** after updating: it teaches the sign-up trigger to use
the chosen username.

### Google (free)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project, then **APIs & Services → OAuth consent screen** (External) and
   fill in the app name and your email.
2. **Credentials → Create credentials → OAuth client ID** → *Web application*.
   - Authorized JavaScript origins: `https://gabarker.com`
   - Authorized redirect URIs: `https://qmgwlvjvwwrlcuupsttb.supabase.co/auth/v1/callback`
3. Paste the client ID and secret into Supabase's **Google** provider and
   enable it.

### Apple (needs a paid Apple Developer account)

Sign in with Apple on the web requires the Apple Developer Program
($99/year). With an account, follow Supabase's guide for **Apple** (a
Services ID, a key and your Team ID), using the same callback URL as Google.

The Apple button is hidden for now. To turn it on later, add `"apple"` back to
`AUTH_PROVIDERS` in `tapmap/config.js`.

## Managing locations

The game reads its places from the `locations` table (falling back to the
built-in list in `tapmap/locations.js` if the database can't be reached).

**Add a place:** Table Editor → `locations` → **Insert row**. Fill in `name`,
`lat`, `lng` (decimal degrees) and `difficulty` (`easy`, `medium` or `hard`).
Leave `added_on` empty (it fills in the day after tomorrow, UTC). Add a
`notes` line too: one short fact shown when the answer is revealed. Or in the
SQL Editor:

```sql
insert into public.locations (name, lat, lng, difficulty, notes)
values ('Table Mountain, South Africa', -33.9628, 18.4098, 'medium',
        'Its flat top is about 3 km wide and often covered by a "tablecloth" of cloud.');
```

- New places join the daily pool **two days later** (`added_on` defaults to
  tomorrow's UTC date, and a place is used from the day after `added_on`).
  Players' days run from UTC−12 to UTC+14, so that way nobody's game changes
  partway through. The game also keeps each player's five places on their
  device once they start.
- **How places are picked:** everyone gets the same five on the same date.
  From 27 September 2026, each difficulty works through its whole list, in a
  shuffled order, before any place comes round again; then it starts a new
  shuffled round. With 36 easy, 50 medium and 47 hard places (from 28
  September 2026), that's a place at most once every 36, 25 and 23 days or
  so, and never twice in a week. Places
  are matched by name, so adding or retiring one never changes an earlier
  game. (Games before 27 September 2026 keep their original places.)
- **Retire a place** by setting `retired_on` to a date at least two days
  ahead instead of deleting it. Don't rename or delete a place that has been
  in the pool: its name is how the picker tracks it.
- Each day needs at least 1 easy, 2 medium and 2 hard places.

**Handy queries:**

```sql
-- How many places of each difficulty are live today (UTC)
select difficulty, count(*) from public.locations
where added_on < (now() at time zone 'utc')::date
  and (retired_on is null or retired_on > (now() at time zone 'utc')::date)
group by difficulty;

-- Places without a fact yet
select id, name from public.locations where notes is null or trim(notes) = '';

-- Newest additions
select id, name, difficulty, added_on from public.locations order by id desc limit 20;

-- Search by name
select * from public.locations where name ilike '%peru%';
```

## Photo practice places

Photo practice uses its own table, `photo_places` (102 to start: 33 easy,
41 medium, 28 hard), graded by how recognisable the photo is rather than how
well known the name is. Each row's `photo` is the English Wikipedia article
whose main photo is shown (e.g. `Al-Khazneh` for Petra's Treasury). Add rows
the same way as locations:

```sql
insert into public.photo_places (name, lat, lng, difficulty, photo, notes)
values ('Sydney Harbour Bridge, Australia', -33.8523, 151.2108, 'easy',
        'Sydney Harbour Bridge', 'Locals call it "the Coathanger".');
```

If an article's picture is a flag, map or drawing, the round shows a
satellite view instead, so pick articles whose main picture is a photo.

## Profiles and invites

- Every player has a page at `https://gabarker.com/tapmap/profile/{username}`
  (and `/tapmap/profile/` goes to your own). GitHub Pages serves `/404.html`
  for these addresses, which renders the profile.
- Your own profile shows your stats and history, follow requests, following,
  followers, people search, profile editing, sign out and **Invite a friend**.
- Other players' scores, stats and history show only if they've accepted your
  follow request.
- **Invite a friend** shares or copies `https://gabarker.com/tapmap/?invite={you}`.
  Whoever opens it is asked to sign up (or sign in) and then whether to send
  you a follow request.

## Deleting all players

`reset-users.sql` deletes every account, profile, follow and saved result
(locations are kept). It can't be undone. Paste it into the SQL Editor and run.

## Games by date and number

Each saved result has `game_date` (the player's local date: a new game starts
at their midnight) and `game_number` (TapMap No., where No. 1 is 2026-09-24);
the database rejects results where they don't match, or where the total isn't
what the rounds add up to.
Each round also stores the place `name`. For a quick overview:

```sql
select * from public.daily_summary order by game_date desc;

-- This week's league (Monday to Sunday), everyone, in the dashboard
select * from public.weekly_league order by week_start desc, rank;
```

In the app, `weekly_league` only shows you and the players who accepted your
follow (it uses the `games` table's row-level security), and the results
screen ranks those players for the current week.

## Challenges

**Challenge a friend** (on any results screen) saves the game in `challenges`
and shares `https://gabarker.com/tapmap/challenge/{id}` (`/challenge/{id}`
works too). Anyone with the link can see the challenge and play it, signed in
or not. Signed-in players' results go in `challenge_results`, which the
sender and everyone who played that challenge can see; signed-out players'
results stay on their device (and are saved when they next sign in). Your
profile lists the challenges you've sent and played, separately from your
daily games.

```sql
-- Newest challenges and how many have played each
select c.id, c.kind, c.by_name, c.total, c.created_at, count(r.user_id) as played
from public.challenges c left join public.challenge_results r on r.challenge_id = c.id
group by c.id order by c.created_at desc limit 20;
```

## Players without an account

Daily games and challenge results played without signing in are saved too,
in `anonymous_games` and `anonymous_challenge_results`, under a random
`device_id` kept on the player's device (no personal details). They count
towards the overall stats but never towards leaderboards, friends' results
or profile stats. Players can add these rows but can't read them; you see them
in the dashboard. If someone plays signed out and then signs in on the same
device, their result is saved to their account with the same `device_id`,
and the stats count it once.

```sql
-- Players per day, with and without an account
select game_date, game_number, players, signed_in_players, players_without_account, average, best
from public.daily_summary order by game_date desc;
```

(`daily_summary` is for the dashboard only now: it includes the anonymous
games, which the app can't read.) A challenge page lists signed-in players'
results and adds "+ N more played without an account".

## What's stored

| Table | Contents | Who can read | Who can write |
| --- | --- | --- | --- |
| `profiles` | username, display name, photo, time zone | everyone (for search) | the owner (update only) |
| `follows` | follower, followee, status (`pending` / `accepted`) | the two players involved | follower: request, cancel or unfollow; followee: accept, decline or remove |
| `locations` | name, lat, lng, difficulty, added_on, retired_on, notes | everyone | only you, in the dashboard |
| `games` | one row per player per day: date, game number, each round's score, tier, distance, multiplier and guess, total | the player and followers they have accepted | the owner, today's or yesterday's game only, once |

Following someone sends a request. When they accept, you follow each other
(the database adds the follow back automatically), and you can both see each
other's stats, history, charts and pins on the globe during each round.

Profile photos are stored in the public `avatars` storage bucket (created by
`setup.sql`), one folder per player; players can only change their own. The
app crops photos to a small square before uploading (1 MB limit).

**Re-run `setup.sql` after updating** (it's safe to run again). Follows made
before requests existed are kept as accepted.

Results can't be edited or deleted once saved. Stats (played, best, average,
current and longest streak) are worked out from `games` by `profile_stats`. A
current streak counts if the last game was today or yesterday in the player's
time zone (the game saves it to `profiles.time_zone`), the same rule the game
uses.

Past games, challenges and photo practice are unranked and stay on the
player's device; only each day's daily game is saved.

Scores are calculated in the browser, so a determined player could submit a
fake result. That's fine among friends; moving scoring into the database is
the next step if a public leaderboard is added.
