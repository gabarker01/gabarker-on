// Sign in: email + password, or Google. Then back to where you were going.
import { AUTH_PROVIDERS } from "../config.js";
import { isConfigured, getClient, getSession } from "../supabase.js";
import { $, busy, param, toast } from "../ui.js";

// Only ever return to a GeoBarkr page.
const requested = param("next") || "";
const next = /^\/geobarkr\/[^\s]*$/.test(requested) && !requested.startsWith("/geobarkr/signin") ? requested : "/geobarkr/";

if (!isConfigured()) {
  $("#signin-intro").textContent = "GeoBarkr isn't switched on yet: the Supabase project still needs setting up.";
} else {
  const client = await getClient();
  if (await getSession()) location.replace(next);
  client.auth.onAuthStateChange((event, session) => {
    if (session && event === "SIGNED_IN") location.replace(next);
  });

  if (AUTH_PROVIDERS.includes("email")) $("#email-area").hidden = false;
  if (AUTH_PROVIDERS.includes("google")) {
    $("#google-area").hidden = false;
    $("#google-divider").hidden = !AUTH_PROVIDERS.includes("email");
  }

  let mode = "signin";
  const form = $("#email-form");
  function setMode(newMode) {
    mode = newMode;
    $("#tab-signin").setAttribute("aria-selected", String(mode === "signin"));
    $("#tab-signup").setAttribute("aria-selected", String(mode === "signup"));
    $("#name-field").hidden = mode !== "signup";
    form.password.autocomplete = mode === "signup" ? "new-password" : "current-password";
    $("#email-button").textContent = mode === "signup" ? "Create account" : "Sign in";
  }
  $("#tab-signin").addEventListener("click", () => setMode("signin"));
  $("#tab-signup").addEventListener("click", () => setMode("signup"));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    busy($("#email-button"), async () => {
      if (mode === "signup") {
        const name = form.name.value.trim();
        const { data, error } = await client.auth.signUp({
          email, password, options: { data: name ? { full_name: name } : {} },
        });
        if (error) throw error;
        if (!data.session) {
          toast("Account created. Check your email to confirm it, then sign in.");
          setMode("signin");
          return;
        }
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      location.replace(next);
    });
  });

  $("#google-button").addEventListener("click", (event) => {
    busy(event.currentTarget, async () => {
      const redirectTo = `${location.origin}/geobarkr/signin/?next=${encodeURIComponent(next)}`;
      const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
      if (error) throw error;
    });
  });
}
