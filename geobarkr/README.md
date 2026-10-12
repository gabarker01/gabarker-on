# GeoBarkr

A Street View guessing game at **gabarker.com/geobarkr**, rebuilt from the
ServiceNow app in `gabarker01/geobarkr`. You look around a Street View, tap
the map where you think you are, and score up to 5,000 points a round
depending on how close you were. Five rounds a game, in three modes:

- **Single player:** on your own.
- **Multiplayer:** everyone on their own screen; the owner starts the game and
  moves everyone on.
- **In person:** a host laptop or TV shows Street View to the room; players
  join on their phones with a room code or QR code and guess on a map.

Docs: [what was ported and how](docs/FEATURE_PARITY.md) ·
[architecture](docs/ARCHITECTURE.md) · [design](docs/DESIGN.md)

## How it works

- **No build step.** Plain HTML, CSS and JavaScript modules served by GitHub
  Pages. Merging to the branch Pages serves publishes it.
- **Supabase (GeoBarkr's own project, separate from TapMap's)** handles sign
  in, the database and live updates:
  - Sign in with email and password, or Google. Every page needs sign-in.
  - Every game action is a database function (`supabase/migrations/002_functions.sql`)
    that checks who's asking and works out distances and scores itself.
  - Row-level security (`003_security.sql`) means players only see their own
    games and guesses, never the answers, and only admins can change maps.
  - Each game has a private live channel; screens also re-check every 15
    seconds in case a phone was asleep.
- **Google Maps JavaScript API** for Street View and the map, with a key that
  only works on gabarker.com/geobarkr.
- The page code only holds public keys. No secrets are in the repo, and no
  GitHub secrets are needed.

```
geobarkr/
  index.html, signin/, play/, lobby/, join/, host/, party/, results/,
  games/, leaderboard/, admin/        one folder per page
  js/config.js                        the three public settings (step 6 and 8)
  js/  css/  assets/  vendor/         code, styles, logo + sound, libraries
  supabase/setup.sql                  the whole database, to paste in (step 2)
  supabase/migrations/, seed.sql      the same, in parts
  supabase/tests/                     SQL tests (local Postgres)
  tests/                              unit tests (run by npm test)
  dev/                                local test stack (not used by the site)
  docs/
```

## Setup checklist

Everything here can be done on a phone. Do the steps in order.

### Supabase

1. **Create the project.** [supabase.com/dashboard](https://supabase.com/dashboard)
   → **New project** → name `geobarkr`, a strong database password (save it;
   GeoBarkr never needs it), region nearest you → **Create new project**.
   This is a new project, so TapMap's project isn't touched. (The free plan
   allows two active projects. A free project pauses after a week with no
   use; restore it from the dashboard before a game night.)
2. **Create the database.** In the `geobarkr` project: **SQL Editor → New query**
   → paste the **whole contents** of [`supabase/setup.sql`](supabase/setup.sql)
   (on GitHub: open the file → **⋯ → Copy raw file**) → **Run**. It should
   finish with "Success. No rows returned". It's safe to run again.
3. **Sign-in addresses.** **Authentication → URL Configuration**:
   - Site URL: `https://gabarker.com/geobarkr/`
   - Redirect URLs → **Add URL**: `https://gabarker.com/geobarkr/**`
4. **Email and password.** **Authentication → Sign In / Providers → Email**:
   keep it **enabled**, and turn **Confirm email off** → **Save**. (With it on,
   Supabase emails a confirmation link, but its built-in email only reaches
   members of your Supabase team. To use magic links or confirmations later,
   set up a mail sender under **Authentication → Emails → SMTP Settings**
   first.)
5. **Google sign-in.**
   1. [Google Cloud Console](https://console.cloud.google.com/) → project
      picker → **New project** `GeoBarkr` → **Create**.
   2. **APIs & Services → OAuth consent screen** → **Get started**: app name
      GeoBarkr, your email, audience **External** → **Create**.
   3. **Clients** (or **Credentials → Create credentials → OAuth client ID**)
      → **Web application**:
      - Authorized JavaScript origins: `https://gabarker.com`
      - Authorized redirect URIs: `https://<project-id>.supabase.co/auth/v1/callback`
        (Supabase shows this exact address on its Google provider page.)
   4. Supabase **Authentication → Sign In / Providers → Google**: enable,
      paste the **Client ID** and **Client secret** → **Save**. The secret
      stays in Supabase; it never goes in the repo.
6. **Connect the site.** Supabase **Project Settings → API Keys**: copy the
   **Project URL** and the **publishable** key (`sb_publishable_…`, or the
   legacy `anon` key). Never use the **secret** / `service_role` key. On
   GitHub, edit [`js/config.js`](js/config.js) and paste them into
   `SUPABASE_URL` and `SUPABASE_KEY`.

### Google Maps

7. **Turn on the API.** Google Cloud (same `GeoBarkr` project) → **APIs &
   Services → Library → Maps JavaScript API → Enable**. Billing must be set
   up; Google gives a free monthly allowance.
8. **Create a restricted key.** **APIs & Services → Credentials → Create
   credentials → API key** → open it:
   - Application restrictions: **Websites** → add `https://gabarker.com/geobarkr/*`
   - API restrictions: **Restrict key → Maps JavaScript API**
   - **Save**, then paste the key into `GOOGLE_MAPS_KEY` in [`js/config.js`](js/config.js).
9. **Cap the cost.** **APIs & Services → Maps JavaScript API → Quotas &
   system limits**: set daily limits (for example 500 map loads and 500
   Street View loads a day). **Billing → Budgets & alerts → Create budget**:
   £5 with email alerts. Also restrict or delete the old key that's
   hard-coded in the ServiceNow repo (`AIzaSyAnVm…`): it's public on GitHub.

### After the PR is merged

10. **Sign in once** at [gabarker.com/geobarkr](https://gabarker.com/geobarkr/)
    (create an account or use Google).
11. **Make yourself admin.** Supabase **SQL Editor**:
    ```sql
    update public.profiles set role = 'admin'
    where id = (select id from auth.users where email = 'you@example.com');
    ```
    The **Admin** link appears in the menu after a refresh.
12. **Check it works.** Start a single-player game and play a round. Then try
    an in-person game: open the lobby on a laptop and join from your phone
    with the QR code.

## Managing maps

**Admin** (menu, admins only): add a map, add one location per round (1 to
5) by pasting a Google Maps Street View link from a computer or typing the
latitude and longitude, check the view in the preview (**Use this view**
copies the angle you've turned to), then tick **Active** so players can pick
it. Games already played keep their rounds when locations change.

## Testing locally

Not needed to run the site; for checking changes on a computer with
Postgres 16 and Node 22:

- `npm test`: unit tests, including that `setup.sql` matches the migrations.
- `geobarkr/supabase/tests/run.sh`: the SQL tests (game rules and row-level
  security) on a throwaway Postgres.
- `geobarkr/dev/start.sh`: the site at `http://localhost:8080/geobarkr/` with
  a local stand-in for Supabase. Then `node geobarkr/dev/e2e.mjs` plays every
  mode in several browsers at phone and desktop sizes (needs Playwright).
  Google Maps is replaced by a flat test map there.

If you change the SQL, rebuild `setup.sql` from the migrations and seed (the
unit tests check it), run it again in the SQL Editor, and rerun the SQL
tests.
