// Supabase project for TapMap accounts. The publishable ("anon") key is meant
// to be public: row-level security in supabase/schema.sql protects the data.
// Leave SUPABASE_KEY empty to run TapMap without accounts.
export const SUPABASE_URL = "https://qmgwlvjvwwrlcuupsttb.supabase.co";
export const SUPABASE_KEY = "";

// Sign-in methods to offer, in order. Each must also be enabled in the
// Supabase dashboard (Authentication → Sign In / Providers).
export const AUTH_PROVIDERS = ["google", "apple", "email"];
