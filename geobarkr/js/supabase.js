// The Supabase client (only loaded when a project is configured).
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js?v=12";
import { loadScript } from "./load.js?v=12";

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
