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
Leave `added_on` as today. Or in the SQL Editor:

```sql
insert into public.locations (name, lat, lng, difficulty)
values ('Table Mountain, South Africa', -33.9628, 18.4098, 'medium');
```

- New places join the daily pool **the next day** (UTC), so today's game never
  changes for someone halfway through it.
- **Retire a place** by setting `retired_on` to a future date instead of
  deleting it. Deleting or editing a place that is already in the pool changes
  which places later days pick, so prefer retiring.
- Each day needs at least 1 easy, 2 medium and 2 hard places.

**Handy queries:**

```sql
-- How many places of each difficulty are live today
select difficulty, count(*) from public.locations
where added_on < (now() at time zone 'utc')::date
  and (retired_on is null or retired_on > (now() at time zone 'utc')::date)
group by difficulty;

-- Newest additions
select id, name, difficulty, added_on from public.locations order by id desc limit 20;

-- Search by name
select * from public.locations where name ilike '%peru%';
```

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

Each saved result has `game_date` (UTC) and `game_number` (TapMap No., where
No. 1 is 2026-09-24); the database rejects results where they don't match.
Each round also stores the place `name`. For a quick overview:

```sql
select * from public.daily_summary order by game_date desc;
```

## What's stored

| Table | Contents | Who can read | Who can write |
| --- | --- | --- | --- |
| `profiles` | username, display name | everyone (for search) | the owner (update only) |
| `follows` | follower, followee, status (`pending` / `accepted`) | the two players involved | follower: request, cancel or unfollow; followee: accept, decline or remove |
| `locations` | name, lat, lng, difficulty, added_on, retired_on, notes | everyone | only you, in the dashboard |
| `games` | one row per player per day: date, game number, each round's score, tier, distance, multiplier and guess, total | the player and followers they have accepted | the owner, today's or yesterday's game only, once |

Following someone sends a request. Once they accept, you can see their stats,
today's result and their pins on the globe during each round.

**Re-run `setup.sql` after updating** (it's safe to run again). Follows made
before requests existed are kept as accepted.

Results can't be edited or deleted once saved. Stats (played, best, average,
current and longest streak) are worked out from `games` by `profile_stats`.

Scores are calculated in the browser, so a determined player could submit a
fake result. That's fine among friends; moving scoring into the database is
the next step if a public leaderboard is added.
