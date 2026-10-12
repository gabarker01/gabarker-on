// The Supabase client, the signed-in user and their profile.
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { loadScript } from "./load.js";

const LIBRARY = "/geobarkr/vendor/supabase-2.117.1.js";

let clientPromise = null;

export const isConfigured = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

export function getClient() {
  if (!clientPromise) {
    clientPromise = loadScript(LIBRARY).then(() =>
      window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
      }),
    );
  }
  return clientPromise;
}

export async function getSession() {
  const client = await getClient();
  const { data } = await client.auth.getSession();
  return data.session;
}

// Where to send someone who isn't signed in, coming back here afterwards.
export function signInUrl(next = location.pathname + location.search) {
  return `/geobarkr/signin/?next=${encodeURIComponent(next)}`;
}

// Every GeoBarkr page needs a signed-in player. Sends anyone else to sign in
// and never resolves for them.
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    location.replace(signInUrl());
    return new Promise(() => {});
  }
  return session;
}

let profilePromise = null;
export function getProfile() {
  if (!profilePromise) {
    profilePromise = (async () => {
      const client = await getClient();
      const session = await getSession();
      if (!session) return null;
      const { data, error } = await client
        .from("profiles")
        .select("id, display_name, role")
        .eq("id", session.user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    })();
  }
  return profilePromise;
}

export async function signOut() {
  const client = await getClient();
  await client.auth.signOut();
  location.href = "/geobarkr/signin/";
}
