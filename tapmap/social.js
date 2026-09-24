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

// The location pool from the database, oldest first (the daily picks depend on
// this order). Plain REST so the game doesn't wait for the auth library.
export async function fetchLocations(timeoutMs = 5000) {
  if (!socialEnabled()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/locations?select=name,lat,lng,difficulty,added_on,retired_on&order=id.asc`,
      { headers: { apikey: SUPABASE_KEY }, signal: controller.signal },
    );
    if (!response.ok) throw new Error(`Locations request failed (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
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
  return unwrap(await client.from("profiles").select("id, username, display_name").eq("id", userId).maybeSingle());
}

export async function updateProfile(userId, { username, displayName }) {
  return unwrap(await client
    .from("profiles")
    .update({ username, display_name: displayName })
    .eq("id", userId)
    .select("id, username, display_name")
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

export async function saveGame(userId, { date, number, rounds, total, names }) {
  const payload = rounds.map((r, i) => ({
    name: names ? names[i] : undefined,
    score: r.score,
    tier: r.tier,
    km: Math.round(r.distanceKm * 10) / 10,
    multiplier: r.multiplier,
    guess: { lat: +r.guess.lat.toFixed(4), lng: +r.guess.lng.toFixed(4) },
  }));
  // Results can't be changed once saved, so "already saved" (23505) is fine.
  const { error } = await client
    .from("games")
    .insert({ user_id: userId, game_date: date, game_number: number, rounds: payload, total });
  if (error && error.code !== "23505") throw error;
}

// Today's results from you and everyone who has accepted your follow, best
// first. (Row-level security only returns results you're allowed to see.)
export async function friendsResults(userId, date) {
  const follows = unwrap(await client
    .from("follows").select("followee_id").eq("follower_id", userId).eq("status", "accepted"));
  const ids = [userId, ...follows.map((f) => f.followee_id)];
  return unwrap(await client
    .from("games")
    .select("user_id, total, rounds, profiles(id, username, display_name)")
    .eq("game_date", date)
    .in("user_id", ids)
    .order("total", { ascending: false }));
}

// One player's result for a date, or null if none (or not visible to you).
export async function gameFor(userId, date) {
  return unwrap(await client
    .from("games").select("total, rounds").eq("user_id", userId).eq("game_date", date).maybeSingle());
}

// ---------- Following (requests must be accepted) ----------

const PERSON = "id, username, display_name";

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
