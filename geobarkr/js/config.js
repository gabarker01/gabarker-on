// GeoBarkr's own Supabase project (not TapMap's) and Google Maps key.
// All three values are public by design:
// - the Supabase publishable key only allows what row-level security allows
//   (geobarkr/supabase/migrations/003_security.sql);
// - the Google Maps key is restricted to https://gabarker.com/geobarkr/* in
//   Google Cloud.
// Never put a Supabase secret / service_role key here.
// Setup: geobarkr/README.md.
export const SUPABASE_URL = "https://ouyfjbbgqqjhgikrjcjg.supabase.co";
export const SUPABASE_KEY = "sb_publishable_IkRv524PmJX22EWCNs9TOA_QenumrpU";
export const GOOGLE_MAPS_KEY = "AIzaSyDRgrrsgVXJ5pJLuV7Yj5aJnjj3jYmTV0Q";

// Sign-in methods to offer, in order: "email" (email and password), "google".
// Add "google" once Google sign-in is set up in Supabase (README step 5).
export const AUTH_PROVIDERS = ["email"];

// How often game screens re-check the game, as a safety net for the live
// updates (phones sleeping, flaky Wi-Fi).
export const POLL_MS = 15000;
