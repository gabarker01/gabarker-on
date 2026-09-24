// Accounts and social features for TapMap, backed by Supabase.
// Everything here is optional: if no key is configured, or the library can't
// load, TapMap keeps working as a local-only game.

import { SUPABASE_URL, SUPABASE_KEY } from "./config.js?v=2";

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

// ---------- Auth ----------

export async function currentUser() {
  const { data } = await client.auth.getSession();
  return data.session ? data.session.user : null;
}

export function onAuthChange(callback) {
  client.auth.onAuthStateChange((_event, session) => callback(session ? session.user : null));
}

export async function signInWithProvider(provider) {
  unwrap(await client.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } }));
}

export async function signInWithEmail(email) {
  unwrap(await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } }));
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

export async function saveGame(userId, { date, number, rounds, total }) {
  const payload = rounds.map((r) => ({
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

// Today's results from you and everyone you follow, best first.
export async function friendsResults(userId, date) {
  const follows = unwrap(await client.from("follows").select("followee_id").eq("follower_id", userId));
  const ids = [userId, ...follows.map((f) => f.followee_id)];
  return unwrap(await client
    .from("games")
    .select("user_id, total, rounds, profiles(username, display_name)")
    .eq("game_date", date)
    .in("user_id", ids)
    .order("total", { ascending: false }));
}

// ---------- Following ----------

export async function listFollowing(userId) {
  const rows = unwrap(await client
    .from("follows")
    .select("followee_id, profiles!follows_followee_id_fkey(id, username, display_name)")
    .eq("follower_id", userId)
    .order("created_at", { ascending: false }));
  return rows.map((r) => r.profiles).filter(Boolean);
}

export async function searchProfiles(query, excludeId) {
  const q = query.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (q.length < 2) return [];
  const rows = unwrap(await client
    .from("profiles")
    .select("id, username, display_name")
    .ilike("username", `${q}%`)
    .order("username")
    .limit(8));
  return rows.filter((r) => r.id !== excludeId);
}

export async function follow(userId, followeeId) {
  unwrap(await client.from("follows").insert({ follower_id: userId, followee_id: followeeId }));
}

export async function unfollow(userId, followeeId) {
  unwrap(await client.from("follows").delete().eq("follower_id", userId).eq("followee_id", followeeId));
}
