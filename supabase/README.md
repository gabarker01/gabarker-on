# TapMap accounts: Supabase setup

TapMap works without accounts. Once these steps are done, players can sign in
(Google, Apple or an email link), keep their stats across devices, follow
friends and see friends' scores for the day.

Project: `https://qmgwlvjvwwrlcuupsttb.supabase.co` (free tier).

## 1. Create the tables

Dashboard → **SQL Editor** → **New query** → paste all of `schema.sql` → **Run**.

This creates `profiles`, `follows`, `games` and the `profile_stats` view, turns
on row-level security, and adds a trigger that gives every new user a profile.
It is safe to run again after changes.

Then run `locations.sql` the same way. It creates the `locations` table and
fills it with the launch set of 68 places.

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

### Email link (on by default)

Supabase's built-in email sender is limited to a few emails an hour and is
meant for testing. For real use, add free SMTP from a provider such as
Resend or Brevo under **Authentication → Emails → SMTP Settings**.

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

Until then, remove `"apple"` from `AUTH_PROVIDERS` in `tapmap/config.js` so
the button doesn't show.

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

## What's stored

| Table | Contents | Who can read | Who can write |
| --- | --- | --- | --- |
| `profiles` | username, display name | everyone | the owner (update only) |
| `follows` | who follows whom | everyone | the follower (add/remove) |
| `locations` | name, lat, lng, difficulty, added_on, retired_on, notes | everyone | only you, in the dashboard |
| `games` | one row per player per day: date, game number, each round's score, tier, distance, multiplier and guess, total | everyone | the owner, today's or yesterday's game only, once |

Results can't be edited or deleted once saved. Stats (played, best, average,
current and longest streak) are worked out from `games` by `profile_stats`.

Scores are calculated in the browser, so a determined player could submit a
fake result. That's fine among friends; moving scoring into the database is
the next step if a public leaderboard is added.
