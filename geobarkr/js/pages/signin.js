// Sign in: email + password or Google; in demo mode, just your name. Then
// back to where you were going.
import { AUTH_PROVIDERS } from "../config.js?v=14";
import { isDemo, getSession } from "../api.js?v=14";
import { $, busy, param, toast, logoMark, pageReady } from "../ui.js?v=14";
import { drawWorld } from "../worldmap.js?v=14";

$("#brand").prepend(logoMark(34));

// Quiet great-circle routes behind the form.
const CITIES = { london: [51.5, -0.12], ny: [40.71, -74], tokyo: [35.68, 139.69], sydney: [-33.87, 151.21], paris: [48.86, 2.35],
  rio: [-22.91, -43.17], singapore: [1.35, 103.8], dubai: [25.2, 55.27], joburg: [-26.2, 28], mexico: [19.43, -99.13], la: [34.05, -118.24], reykjavik: [64.15, -21.94], stockholm: [59.33, 18.06] };
const ROUTES = [["london", "ny"], ["london", "tokyo"], ["paris", "sydney"], ["ny", "rio"], ["singapore", "sydney"], ["dubai", "joburg"], ["mexico", "la"], ["reykjavik", "stockholm"]];
const at = (k) => ({ lat: CITIES[k][0], lng: CITIES[k][1] });
const mapDrawn = drawWorld($("#signin-map"), {
  view: { lat: 28, lng: 10, zoom: 0.25 },
  arcs: ROUTES.map(([a, b]) => ({ from: at(a), to: at(b), colour: "#5E6B7D", width: 1.5, opacity: 0.75 })),
  dots: Object.keys(CITIES).map((k) => ({ ...at(k), colour: "#5E6B7D", r: 2.6 })),
});

// Only ever return to a GeoBarkr page.
const requested = param("next") || "";
const next = /^\/geobarkr\/[^\s]*$/.test(requested) && !requested.startsWith("/geobarkr/signin") ? requested : "/geobarkr/";
let leaving = false;
const goNext = () => {
  if (leaving) return;
  leaving = true;
  location.replace(next);
};

if (await getSession()) goNext();
else Promise.race([mapDrawn, new Promise((done) => setTimeout(done, 1500))]).then(pageReady);

if (isDemo) {
  const { signInDemo } = await import("../demo.js?v=14");
  const form = $("#demo-form");
  form.hidden = false;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(form.querySelector("button"), async () => {
      await signInDemo(form.name.value);
      goNext();
    });
  });
} else {
  const { getClient } = await import("../supabase.js?v=14");
  const client = await getClient();
  client.auth.onAuthStateChange((event, session) => {
    if (session && event === "SIGNED_IN") goNext(); // back from Google
  });

  if (AUTH_PROVIDERS.includes("email")) {
    $("#email-area").hidden = false;
    $("#switch-line").hidden = false;
  }
  if (AUTH_PROVIDERS.includes("google")) {
    $("#google-area").hidden = false;
    $("#google-divider").hidden = !AUTH_PROVIDERS.includes("email");
  }

  let mode = "signin";
  const form = $("#email-form");
  const setMode = (newMode) => {
    mode = newMode;
    $("#name-field").hidden = mode !== "signup";
    form.password.autocomplete = mode === "signup" ? "new-password" : "current-password";
    $("#email-button").textContent = mode === "signup" ? "Create account" : "Sign in";
    $("#switch-text").textContent = mode === "signup" ? "Have an account?" : "New here?";
    $("#switch-link").textContent = mode === "signup" ? "Sign in" : "Create an account";
  };
  $("#switch-link").addEventListener("click", (event) => {
    event.preventDefault();
    setMode(mode === "signin" ? "signup" : "signin");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    busy($("#email-button"), async () => {
      if (mode === "signup") {
        const name = form.name.value.trim();
        const { data, error } = await client.auth.signUp({ email, password, options: { data: name ? { full_name: name } : {} } });
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
      goNext();
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
