// Accounts and social features for TapMap, backed by Supabase.
// Everything here is optional: if no key is configured, or the library can't
// load, TapMap keeps working as a local-only game.

import { SUPABASE_URL, SUPABASE_KEY } from "./config.js?v=3";

const LIBRARY = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/dist/umd/supabase.js";

let client = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.append(script);
  });
}

export const socialEnabled = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

// Returns true once the client is ready (and any sign-in redirect is handled).
export async function initSocial() {
  if (!socialEnabled()) return false;
  if (client) return true;
  await loadScript(LIBRARY);
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
  });
  // Finishes an OAuth or email-link sign-in, then tidies the address bar.
  await client.auth.getSession();
  if (/[?&#](code|error|access_token)=/.test(window.location.href)) {
    window.history.replaceState(null, "", window.location.pathname);
  }
  return true;
}

const redirectTo = () => `${window.location.origin}${window.location.pathname}`;

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// ---------- Locations ----------

// The whole location list from the database, oldest first, including places
// not yet live or already retired (the daily picker replays every day since
// launch). Plain REST so the game doesn't wait for the auth library. (All
// columns, so a database that hasn't been updated yet still works.)
export async function fetchLocations(timeoutMs = 5000) {
  if (!socialEnabled()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/locations?select=*&order=id.asc`,
      { headers: { apikey: SUPABASE_KEY }, signal: controller.signal },
    );
    if (!response.ok) throw new Error(`Locations request failed (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// The places for photo practice (see photo_places in supabase/locations.sql).
export async function fetchPhotoPlaces(timeoutMs = 5000) {
  if (!socialEnabled()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/photo_places?select=*&order=id.asc`, { headers: { apikey: SUPABASE_KEY }, signal: controller.signal });
    if (!response.ok) throw new Error(`Photo places request failed (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// The signed-in user's id from the saved session on this device, without
// waiting for the auth library (null if not signed in). Only a hint: the
// session isn't checked with the server.
export function cachedUserId() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!/^sb-.*-auth-token$/.test(key)) continue;
      const session = JSON.parse(localStorage.getItem(key));
      const id = session && (session.user ? session.user.id : session.currentSession && session.currentSession.user && session.currentSession.user.id);
      if (id) return id;
    }
  } catch (e) {}
  return null;
}

// ---------- Challenges ----------

// (A challenge reaches profiles two ways: its sender, created_by, and the
// players, through challenge_results. The API won't guess which, so the
// embeds below name created_by.)

// One challenge by id, with the sender's profile. Plain REST (challenges are
// public), so it works signed out and without waiting for the auth library.
export async function fetchChallenge(id, timeoutMs = 8000) {
  if (!socialEnabled()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const get = (select) => fetch(
    `${SUPABASE_URL}/rest/v1/challenges?id=eq.${encodeURIComponent(id)}&select=${select}`,
    { headers: { apikey: SUPABASE_KEY }, signal: controller.signal },
  );
  try {
    let response = await get("*,profiles!created_by(username,display_name,avatar_url)");
    // If the sender's profile can't be included, the challenge itself is enough.
    if (!response.ok && response.status === 400) response = await get("*");
    if (!response.ok) throw new Error(`Challenge request failed (${response.status})`);
    const rows = await response.json();
    return rows[0] || null;
  } finally {
    clearTimeout(timer);
  }
}

const challengeRounds = (rounds) => rounds.map((r) => ({
  score: r.score,
  km: Math.round(r.distanceKm * 10) / 10,
  multiplier: r.multiplier,
  tier: r.tier,
  ...(r.guess ? { guess: { lat: +r.guess.lat.toFixed(4), lng: +r.guess.lng.toFixed(4) } } : {}),
}));

// Everyone's results for a challenge, with their profiles (public, like the
// challenge). Plain REST, for the other players' pins while you play it.
export async function fetchChallengeResults(id, timeoutMs = 8000) {
  if (!socialEnabled()) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/challenge_results?challenge_id=eq.${encodeURIComponent(id)}&select=user_id,total,rounds,profiles(id,username,display_name,avatar_url)`,
      { headers: { apikey: SUPABASE_KEY }, signal: controller.signal },
    );
    return response.ok ? await response.json() : [];
  } finally {
    clearTimeout(timer);
  }
}

// Saves a finished game as a challenge and returns its id. Works signed out
// (the challenge is then anonymous).
export async function createChallenge({ userId, byName, kind, number, places, rounds, total, challengedUser }) {
  const row = {
    created_by: userId || null,
    by_name: byName || null,
    kind,
    game_number: number || null,
    places: places.map((l) => ({ name: l.name, lat: l.lat, lng: l.lng, difficulty: l.difficulty, notes: l.notes || null, photo: l.photo || null })),
    rounds: challengeRounds(rounds),
    total,
    ...(challengedUser && userId ? { challenged_user: challengedUser } : {}),
  };
  return unwrap(await client.from("challenges").insert(row).select("id").single()).id;
}

// Saves your result for a challenge (once; "already saved" is fine).
export async function saveChallengeResult(challengeId, userId, rounds, total, deviceId) {
  await insertOnce("challenge_results", { challenge_id: challengeId, user_id: userId, rounds: challengeRounds(rounds), total, device_id: deviceId || undefined });
}

// Everyone's results for a challenge that you can see (you sent it or played it).
export async function challengeResults(challengeId) {
  return unwrap(await client
    .from("challenge_results")
    .select("user_id, total, rounds, created_at, profiles(id, username, display_name, avatar_url)")
    .eq("challenge_id", challengeId)
    .order("total", { ascending: false }));
}

// Your challenges for your profile: ones you sent (with everyone's results)
// and ones you played (with the sender's score).
export async function myChallenges(userId, limit = 50) {
  const [sent, played, received] = await Promise.all([
    client.from("challenges")
      .select("id, kind, game_number, total, created_at, challenge_results(user_id, total, profiles(username, display_name))")
      .eq("created_by", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    client.from("challenge_results")
      .select("total, created_at, challenges(id, kind, game_number, total, by_name, created_by, created_at, profiles!created_by(username, display_name))")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    // Sent to you from your profile (whether or not you've played them yet).
    client.from("challenges")
      .select("id, kind, game_number, total, by_name, created_by, created_at, profiles!created_by(username, display_name)")
      .eq("challenged_user", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);
  // (Before setup.sql adds challenged_user, that query fails: no received list.)
  return { sent: unwrap(sent), played: unwrap(played), received: received.error ? [] : received.data };
}

// ---------- Auth ----------

// Which sign-in methods are switched on in the Supabase dashboard, e.g.
// { google: true, email: true, apple: false }. Null if it can't be checked.
export async function enabledProviders() {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
    if (!response.ok) return null;
    const settings = await response.json();
    return settings && settings.external ? settings.external : null;
  } catch (error) {
    return null;
  }
}

// Checks a saved sign-in with the server. If the account no longer exists
// (e.g. it was deleted), the stale sign-in is cleared and null returned.
export async function verifiedUser() {
  const { data, error } = await client.auth.getUser();
  if (error || !data || !data.user) {
    await client.auth.signOut({ scope: "local" });
    return null;
  }
  return data.user;
}

export async function currentUser() {
  const { data } = await client.auth.getSession();
  return data.session ? data.session.user : null;
}

// callback(user, event); event is e.g. "SIGNED_IN" or "PASSWORD_RECOVERY".
export function onAuthChange(callback) {
  client.auth.onAuthStateChange((event, session) => callback(session ? session.user : null, event));
}

export async function signInWithProvider(provider) {
  unwrap(await client.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } }));
}

// Username accounts: Supabase needs an email per account, so each username
// maps to a private placeholder address that never receives mail. Requires
// "Confirm email" to be off in the dashboard.
const USERNAME_DOMAIN = "players.gabarker.com";
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const usernameEmail = (username) => `${username.toLowerCase()}@${USERNAME_DOMAIN}`;
export const isUsernameAccount = (user) => Boolean(user && user.email && user.email.endsWith(`@${USERNAME_DOMAIN}`));

// Signs in with a username, or with an email for accounts made that way.
export async function signInWithPassword(identifier, password) {
  const id = identifier.trim();
  const email = id.includes("@") ? id : usernameEmail(id);
  unwrap(await client.auth.signInWithPassword({ email, password }));
}

export async function usernameTaken(username) {
  const rows = unwrap(await client.from("profiles").select("id").eq("username", username.toLowerCase()).limit(1));
  return rows.length > 0;
}

// Returns true if signed in straight away, false if Supabase still wants an
// email confirmation (i.e. "Confirm email" is on).
export async function signUpWithUsername(username, password) {
  const name = username.toLowerCase();
  const data = unwrap(await client.auth.signUp({
    email: usernameEmail(name),
    password,
    options: { data: { username: name, display_name: name } },
  }));
  return Boolean(data.session);
}

export async function sendPasswordReset(email) {
  unwrap(await client.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() }));
}

export async function updatePassword(password) {
  unwrap(await client.auth.updateUser({ password }));
}

export async function signOut() {
  await client.auth.signOut();
}

// ---------- Profiles & stats ----------

export async function getProfile(userId) {
  return unwrap(await client.from("profiles").select("id, username, display_name, avatar_url").eq("id", userId).maybeSingle());
}

export async function updateProfile(userId, { username, displayName }) {
  return unwrap(await client
    .from("profiles")
    .update({ username, display_name: displayName })
    .eq("id", userId)
    .select("id, username, display_name, avatar_url")
    .single());
}

export async function getStats(userId) {
  return unwrap(await client
    .from("profile_stats")
    .select("played, best, average, current_streak, max_streak")
    .eq("user_id", userId)
    .maybeSingle());
}

// ---------- Games ----------

const gameRounds = (rounds, names) => rounds.map((r, i) => ({
  name: names ? names[i] : undefined,
  score: r.score,
  tier: r.tier,
  km: Math.round(r.distanceKm * 10) / 10,
  multiplier: r.multiplier,
  guess: { lat: +r.guess.lat.toFixed(4), lng: +r.guess.lng.toFixed(4) },
}));

// The player's time zone, as the device reports it (saved with each game).
const deviceTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch (e) { return undefined; }
};

// Inserts a row; "already saved" (23505) is fine. device_id and time_zone are
// left out if the database doesn't have those columns yet (setup.sql not re-run).
async function insertOnce(table, row) {
  let { error } = await client.from(table).insert(row);
  if (error && (error.code === "PGRST204" || /device_id|time_zone/.test(error.message || ""))) {
    const { device_id: _d, time_zone: _t, ...rest } = row;
    ({ error } = await client.from(table).insert(rest));
  }
  if (error && error.code !== "23505") throw error;
}

export async function saveGame(userId, { date, number, rounds, total, names, deviceId }) {
  // Results can't be changed once saved. deviceId links it to the same game
  // if it was first saved without an account, so it's only counted once.
  await insertOnce("games", {
    user_id: userId, game_date: date, game_number: number, rounds: gameRounds(rounds, names), total,
    device_id: deviceId || undefined, time_zone: deviceTimeZone(),
  });
}

// A new account takes over the games this device played without one, so its
// streak and stats carry over (the database only does this in the account's
// first day). Resolves to how many games were moved.
export async function claimDeviceGames(deviceId) {
  const { data, error } = await client.rpc("claim_device_games", { device: deviceId });
  if (error) throw error;
  return Number(data) || 0;
}

// Games and challenge results without an account: counted in the overall
// stats, never on leaderboards. Plain REST, so they're saved even if the
// sign-in library can't load; the database accepts them but never returns them.
async function postAnonymous(table, row) {
  if (!socialEnabled()) return;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!response.ok && response.status !== 409) throw new Error(`Couldn't save to ${table} (${response.status})`);
}

// A daily game without an account is a row in games with no player (the
// database records whether you were signed in). Until setup.sql is re-run,
// it goes to the old anonymous_games table instead.
export async function saveAnonymousGame(deviceId, { date, number, rounds, total, names }) {
  const row = { device_id: deviceId, game_date: date, game_number: number, rounds: gameRounds(rounds, names), total };
  try {
    await postAnonymous("games", { ...row, signed_in: false, time_zone: deviceTimeZone() });
  } catch (error) {
    await postAnonymous("anonymous_games", row);
  }
}

export const saveAnonymousChallengeResult = (challengeId, deviceId, rounds, total) =>
  postAnonymous("anonymous_challenge_results", { challenge_id: challengeId, device_id: deviceId, rounds: challengeRounds(rounds), total });

// How many played a challenge without an account.
export async function anonymousChallengePlayers(challengeId) {
  if (!socialEnabled()) return 0;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/anonymous_challenge_players`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ cid: challengeId }),
  });
  if (!response.ok) return 0;
  const count = await response.json();
  return Number.isInteger(count) ? count : 0;
}

// Today's results from you and everyone who has accepted your follow, best
// first. (Row-level security only returns results you're allowed to see.)
export async function friendsResults(userId, date) {
  const follows = unwrap(await client
    .from("follows").select("followee_id").eq("follower_id", userId).eq("status", "accepted"));
  const ids = [userId, ...follows.map((f) => f.followee_id)];
  return unwrap(await client
    .from("games")
    .select("user_id, total, rounds, profiles(id, username, display_name, avatar_url)")
    .eq("game_date", date)
    .in("user_id", ids)
    .order("total", { ascending: false }));
}

// This week's league (Monday to Sunday): you and everyone who has accepted
// your follow, ranked by points. Row-level security limits it to those.
export async function weeklyLeague(weekStart) {
  return unwrap(await client
    .from("weekly_league")
    .select("user_id, username, display_name, avatar_url, played, points, best, rank")
    .eq("week_start", weekStart)
    .order("rank", { ascending: true })
    .order("username", { ascending: true }));
}

// Saves the player's time zone, so their streak follows their own date.
export async function saveTimeZone(userId, timeZone) {
  unwrap(await client.from("profiles").update({ time_zone: timeZone }).eq("id", userId));
}

// One player's result for a date, or null if none (or not visible to you).
export async function gameFor(userId, date) {
  return unwrap(await client
    .from("games").select("total, rounds").eq("user_id", userId).eq("game_date", date).maybeSingle());
}

// ---------- Following (requests must be accepted) ----------

const PERSON = "id, username, display_name, avatar_url";

// Everyone you follow or have asked to follow: [{ ...profile, status }].
export async function listFollowing(userId) {
  const rows = unwrap(await client
    .from("follows")
    .select(`status, profiles!follows_followee_id_fkey(${PERSON})`)
    .eq("follower_id", userId)
    .order("created_at", { ascending: false }));
  return rows.filter((r) => r.profiles).map((r) => ({ ...r.profiles, status: r.status }));
}

// People asking to follow you.
export async function listRequests(userId) {
  const rows = unwrap(await client
    .from("follows")
    .select(`profiles!follows_follower_id_fkey(${PERSON})`)
    .eq("followee_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false }));
  return rows.map((r) => r.profiles).filter(Boolean);
}

// People you've accepted as followers.
export async function listFollowers(userId) {
  const rows = unwrap(await client
    .from("follows")
    .select(`profiles!follows_follower_id_fkey(${PERSON})`)
    .eq("followee_id", userId)
    .eq("status", "accepted")
    .order("created_at", { ascending: false }));
  return rows.map((r) => r.profiles).filter(Boolean);
}

// Players whose username or display name contains the query.
export async function searchProfiles(query, excludeId) {
  // Strip characters that have meaning in PostgREST filters.
  const q = query.replace(/[%,()*\\"]/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < 2) return [];
  const rows = unwrap(await client
    .from("profiles")
    .select(PERSON)
    .or(`username.ilike."*${q}*",display_name.ilike."*${q}*"`)
    .order("username")
    .limit(10));
  return rows.filter((r) => r.id !== excludeId);
}

export async function getProfileByUsername(username) {
  return unwrap(await client
    .from("profiles").select(PERSON).eq("username", username.toLowerCase()).maybeSingle());
}

// Your relationship with another player: null, "pending" or "accepted".
export async function followStatus(userId, otherId) {
  const row = unwrap(await client
    .from("follows").select("status").eq("follower_id", userId).eq("followee_id", otherId).maybeSingle());
  return row ? row.status : null;
}

// Recent daily results for a player (only returned if you may see them).
export async function recentGames(userId, limit = 30) {
  return unwrap(await client
    .from("games")
    .select("game_date, game_number, total, rounds")
    .eq("user_id", userId)
    .order("game_date", { ascending: false })
    .limit(limit));
}

export async function requestFollow(userId, followeeId) {
  const { error } = await client.from("follows").insert({ follower_id: userId, followee_id: followeeId });
  if (error && error.code !== "23505") throw error;
}

export async function acceptRequest(userId, followerId) {
  unwrap(await client
    .from("follows").update({ status: "accepted" }).eq("follower_id", followerId).eq("followee_id", userId));
}

// Unfollow, cancel a request, decline a request or remove a follower.
export async function endFollow(followerId, followeeId) {
  unwrap(await client.from("follows").delete().eq("follower_id", followerId).eq("followee_id", followeeId));
}

// ---------- Profile photos ----------

const AVATAR_BUCKET = "avatars";

// Uploads a square image blob as the player's photo and saves its URL.
export async function uploadAvatar(userId, blob) {
  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
  const path = `${userId}/avatar.${ext}`;
  unwrap(await client.storage.from(AVATAR_BUCKET).upload(path, blob, { upsert: true, contentType: blob.type, cacheControl: "3600" }));
  const { data } = client.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const url = `${data.publicUrl}?v=${Date.now()}`;
  return unwrap(await client
    .from("profiles").update({ avatar_url: url }).eq("id", userId).select(PERSON).single());
}

export async function removeAvatar(userId) {
  await client.storage.from(AVATAR_BUCKET).remove(["webp", "png", "jpg"].map((ext) => `${userId}/avatar.${ext}`));
  return unwrap(await client
    .from("profiles").update({ avatar_url: null }).eq("id", userId).select(PERSON).single());
}
