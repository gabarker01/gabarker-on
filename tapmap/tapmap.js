import { LOCATIONS } from "./locations.js";
import {
  ROUNDS, ROUND_PLAN, MAX_SCORE, GAME_URL,
  utcDateKey, gameNumber, msUntilNextGame,
  dailyLocations, practiceLocations, poolFor, evaluateGuess, totalScore,
  rating, formatNumber, shareText,
  recordDailyResult, currentStreak,
} from "./game.js";
import { createGlobe, createSummaryGlobe } from "./map.js";
import { AUTH_PROVIDERS } from "./config.js?v=3";
import * as social from "./social.js?v=3";

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Storage (optional: the game works without it) ----------

const storage = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  },
};

const DAILY_KEY = "tapmap:v4:daily";
const STATS_KEY = "tapmap:v4:stats";

// ---------- Formatting ----------

const KM_PER_MILE = 1.609344;
const TIERS = {
  "🎯": { cls: "t-bullseye", label: "Within 50 km" },
  "🟩": { cls: "t-close", label: "Within 500 km" },
  "🟨": { cls: "t-near", label: "Within 1,500 km" },
  "🟧": { cls: "t-far", label: "Within 3,000 km" },
  "🟥": { cls: "t-off", label: "Over 3,000 km" },
};
const ROMAN = ["i", "ii", "iii", "iv", "v"];
const formatLength = (value) => (value < 10 ? value.toFixed(1) : formatNumber(value));
const formatMultiplier = (m) => `×${m}`;
// Weighted round points can end in .5 (e.g. 91 × 1.5 = 136.5).
const formatPoints = (n) => (Number.isInteger(n) ? formatNumber(n) : n.toFixed(1));
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const longDate = new Date(`${utcDateKey()}T12:00:00Z`).toLocaleDateString("en-GB", {
  weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
});

function tierDot(tier) {
  const dot = document.createElement("span");
  dot.className = `tier-dot ${TIERS[tier].cls}`;
  return dot;
}

// ---------- Globe colours (from CSS tokens) ----------

function globeColors() {
  const css = getComputedStyle(root);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    space: v("--space-edge"),
    ocean: v("--globe-ocean"),
    land: v("--globe-land"),
    atmosphere: v("--globe-atmosphere"),
    arc: v("--globe-arc"),
    guess: v("--globe-guess"),
    answer: v("--globe-answer"),
  };
}

let globe = null;
let summary = null;

// ---------- Helpers ----------

function animateCount(el, from, to, duration = 700) {
  if (reducedMotion || from === to) {
    el.textContent = formatNumber(to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = formatNumber(from + (to - from) * (1 - (1 - t) ** 3));
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (err) {}
    area.remove();
    return ok;
  }
}

function openOverlay(el) {
  el.hidden = false;
  const focusTarget = el.querySelector("button:not([hidden])");
  if (focusTarget) focusTarget.focus({ preventScroll: true });
}

// ---------- Game state ----------

const today = utcDateKey();
const todayNumber = gameNumber(today);
// Today's pool comes from the database when it can be reached, otherwise from
// the built-in list (the database's launch set, in the same order).
let pool = poolFor(today, LOCATIONS);
let todaysLocations = dailyLocations(today, pool);

const hasEnoughFor = (locations) =>
  ["easy", "medium", "hard"].every((level) =>
    locations.filter((l) => l.difficulty === level).length >= ROUND_PLAN.filter((r) => r.difficulty === level).length);

async function loadPool() {
  try {
    const rows = await social.fetchLocations();
    const valid = (rows || []).filter((r) =>
      r && typeof r.name === "string" && Number.isFinite(r.lat) && Number.isFinite(r.lng) && ["easy", "medium", "hard"].includes(r.difficulty));
    const todays = poolFor(today, valid);
    if (hasEnoughFor(todays)) {
      pool = todays;
      todaysLocations = dailyLocations(today, pool);
    }
  } catch (error) {
    console.warn("Using the built-in location list:", error);
  }
}

function loadDaily() {
  const saved = storage.get(DAILY_KEY);
  return saved && saved.date === today && Array.isArray(saved.rounds)
    ? saved
    : { date: today, rounds: [] };
}

let daily = loadDaily();
let game = null; // { mode, locations, rounds, index, phase, guess }

const dailyDone = () => daily.rounds.length >= ROUNDS;

function newGame(mode) {
  if (mode === "daily") {
    return { mode, locations: todaysLocations, rounds: daily.rounds, index: daily.rounds.length, phase: "guessing", guess: null };
  }
  return { mode, locations: practiceLocations(pool), rounds: [], index: 0, phase: "guessing", guess: null };
}

// ---------- Header ----------

function updateHeader(totalOverride) {
  $("game-label").textContent = game && game.mode === "practice" ? "Practice" : `No. ${todayNumber}`;
  const playing = Boolean(game) && game.phase !== "done";
  document.querySelectorAll("#progress span").forEach((dot, i) => {
    dot.classList.toggle("is-done", Boolean(game) && i < game.rounds.length);
    dot.classList.toggle("is-current", playing && i === game.index && i >= game.rounds.length);
  });
  $("progress").hidden = !playing;
  if (!playing) {
    $("tally").textContent = "";
    return;
  }
  const total = totalOverride ?? totalScore(game.rounds);
  $("tally").textContent = `Round ${game.index + 1}/${ROUNDS} · ${formatNumber(total)} pts`;
}

// ---------- Rounds ----------

const prompt = $("prompt");
const actionBar = $("action-bar");
const confirmButton = $("confirm-button");
const result = $("result");

function showRound() {
  const location = game.locations[game.index];
  const plan = ROUND_PLAN[game.index];
  game.phase = "guessing";
  game.guess = null;

  $("prompt-round").textContent = `Round ${ROMAN[game.index]}`;
  $("prompt-difficulty").textContent = capitalise(location.difficulty);
  $("prompt-multiplier").textContent = formatMultiplier(plan.multiplier);
  $("prompt-name").textContent = location.name;

  // Replay the entrance animation each round.
  prompt.hidden = true;
  void prompt.offsetWidth;
  prompt.hidden = false;

  actionBar.hidden = false;
  $("tap-help").hidden = false;
  confirmButton.hidden = false;
  confirmButton.disabled = true;
  result.hidden = true;

  updateHeader();
  globe.reset();
}

function onGlobeTap(lnglat) {
  if (!game || game.phase !== "guessing") return;
  game.guess = lnglat;
  globe.setGuess(lnglat);
  confirmButton.disabled = false;
  $("tap-help").hidden = true;
}

// Space the globe leaves free around the floating panels, for fitting the view.
function fitPadding() {
  const promptRect = prompt.getBoundingClientRect();
  const barRect = actionBar.getBoundingClientRect();
  return {
    top: Math.round(promptRect.bottom + 40),
    bottom: Math.round(window.innerHeight - barRect.top + 24),
    left: 36,
    right: 72,
  };
}

async function confirmGuess() {
  if (!game || game.phase !== "guessing" || !game.guess) return;
  game.phase = "revealing";
  const location = game.locations[game.index];
  const { multiplier } = ROUND_PLAN[game.index];
  const answer = { lat: location.lat, lng: location.lng };
  const round = { ...evaluateGuess(game.guess, answer, multiplier), answer };
  const before = totalScore(game.rounds);
  game.rounds.push(round);
  if (game.mode === "daily") saveDaily();

  // Show the result panel first so the fit leaves room for it.
  confirmButton.hidden = true;
  $("tap-help").hidden = true;
  $("result-km").textContent = formatLength(round.distanceKm);
  $("result-mi").textContent = `${formatLength(round.distanceKm / KM_PER_MILE)} mi`;
  $("result-tier").replaceChildren(tierDot(round.tier), document.createTextNode(TIERS[round.tier].label));
  $("result-maths").textContent = `${formatMultiplier(multiplier)} · ${formatPoints(round.weighted)} pts`;
  $("result-points").textContent = "0";
  $("result-answer").textContent = location.name;
  $("result-bonus").hidden = true;
  $("next-button").textContent = game.index === ROUNDS - 1 ? "See your results" : "Next round";
  $("next-button").disabled = true;
  result.hidden = false;

  await globe.reveal(game.guess, answer, fitPadding());

  const counting = animateCount($("result-points"), 0, round.score);
  const tallyStart = performance.now();
  const tallyTick = (now) => {
    const t = reducedMotion ? 1 : Math.min(1, (now - tallyStart) / 700);
    updateHeader(before + round.weighted * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(tallyTick);
  };
  requestAnimationFrame(tallyTick);
  await counting;

  if (round.bullseye) {
    const bonus = $("result-bonus");
    bonus.textContent = round.bonus > 0
      ? `Within 25 km. Bullseye bonus of +${round.bonus}.`
      : "Within 25 km. Full marks.";
    bonus.hidden = false;
  }

  game.phase = "revealed";
  $("next-button").disabled = false;
  $("next-button").focus({ preventScroll: true });
}

function nextRound() {
  if (!game || game.phase !== "revealed") return;
  if (game.index < ROUNDS - 1) {
    game.index += 1;
    showRound();
  } else {
    finishGame();
  }
}

function saveDaily() {
  daily.rounds = game.rounds;
  storage.set(DAILY_KEY, daily);
  if (dailyDone()) {
    storage.set(STATS_KEY, recordDailyResult(storage.get(STATS_KEY) || {}, today, totalScore(daily.rounds)));
    syncDaily();
  }
}

// ---------- Results ----------

let countdownTimer;

function finishGame() {
  game.phase = "done";
  prompt.hidden = true;
  actionBar.hidden = true;
  globe.clear();
  updateHeader();
  showEnd(game);
}

function breakdownRow(round, location, i) {
  const li = document.createElement("li");
  const n = document.createElement("span");
  n.className = "n";
  n.textContent = ROMAN[i];

  const info = document.createElement("div");
  const name = document.createElement("p");
  name.className = "name";
  name.textContent = location.name;
  const meta = document.createElement("p");
  meta.className = "meta";
  meta.append(tierDot(round.tier), `${formatLength(round.distanceKm)} km${round.bullseye ? " · bullseye" : ""}`);
  info.append(name, meta);

  const score = document.createElement("p");
  score.className = "score";
  score.textContent = String(round.score);
  const of = document.createElement("span");
  of.className = "of";
  of.textContent = "/100";
  score.append(of);
  const small = document.createElement("small");
  small.textContent = `${formatMultiplier(round.multiplier)} · ${formatPoints(round.weighted)} pts`;
  score.append(small);

  li.append(n, info, score);
  return li;
}

async function showEnd(finished) {
  const rounds = finished.rounds;
  const total = totalScore(rounds);
  const practice = finished.mode === "practice";

  $("end-label").textContent = practice ? "Practice" : `TapMap No. ${todayNumber} · ${longDate}`;
  $("end-rating").textContent = rating(total).label;
  $("final-max").textContent = formatNumber(MAX_SCORE);
  $("final-points").textContent = "0";
  $("breakdown").replaceChildren(...rounds.map((r, i) => breakdownRow(r, finished.locations[i], i)));

  const stats = storage.get(STATS_KEY) || {};
  $("stat-played").textContent = formatNumber(stats.played || 0);
  $("stat-streak").textContent = formatNumber(currentStreak(stats, today));
  $("stat-best").textContent = formatNumber(stats.best || 0);

  $("practice-button").textContent = practice ? "Practice again" : "Practice";
  const dailyButton = $("daily-results-button");
  dailyButton.hidden = !practice;
  dailyButton.textContent = dailyDone() ? "Back to today's result" : "Play today's game";

  const text = shareText({ number: todayNumber, practice, rounds, url: GAME_URL });
  $("copy-button").onclick = async () => {
    toast((await copyText(text)) ? "Copied" : "Couldn't copy. Try again.");
  };
  const shareButton = $("share-button");
  shareButton.hidden = !navigator.share;
  shareButton.onclick = () => navigator.share({ text }).catch(() => {});

  renderFriends(practice);
  if (user) {
    social.getStats(user.id).then((server) => {
      if (!server) return;
      $("stat-played").textContent = formatNumber(server.played);
      $("stat-streak").textContent = formatNumber(server.current_streak);
      $("stat-best").textContent = formatNumber(server.best);
    }).catch(() => {});
  }

  startCountdown();
  openOverlay($("end"));
  animateCount($("final-points"), 0, total, 1100);

  if (summary) summary.destroy();
  summary = null;
  try {
    const details = rounds.map((r, i) => ({
      round: `Round ${i + 1} · ${capitalise(finished.locations[i].difficulty)}`,
      name: finished.locations[i].name,
      meta: `${formatLength(r.distanceKm)} km · ${formatMultiplier(r.multiplier)} · ${formatPoints(r.weighted)} pts`,
    }));
    summary = await createSummaryGlobe($("summary-globe"), rounds, { colors: globeColors(), details, reducedMotion });
  } catch (error) {
    console.error(error);
  }
}

function startCountdown() {
  clearInterval(countdownTimer);
  const el = $("next-game");
  const tick = () => {
    if (utcDateKey() !== today) {
      el.textContent = "A new TapMap is ready. Refresh to play.";
      clearInterval(countdownTimer);
      return;
    }
    const ms = msUntilNextGame();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    el.textContent = `Next game in ${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// ---------- Starting games ----------

function start(mode) {
  $("intro").hidden = true;
  $("end").hidden = true;
  clearInterval(countdownTimer);
  if (summary) {
    summary.destroy();
    summary = null;
  }
  game = newGame(mode);
  if (mode === "daily" && dailyDone()) {
    game.phase = "done";
    updateHeader();
    showEnd(game);
    return;
  }
  showRound();
}

function showIntro({ help = false } = {}) {
  const partial = daily.rounds.length > 0 && !dailyDone();
  $("intro-number").textContent = `No. ${todayNumber} · ${longDate}`;
  $("play-button").textContent = dailyDone()
    ? "See today's result"
    : partial ? "Continue today's game" : "Play today's game";
  $("play-button").hidden = help;
  $("intro-practice-button").hidden = help;
  $("intro-close").hidden = !help;
  openOverlay($("intro"));
}

// ---------- Wiring ----------

confirmButton.addEventListener("click", confirmGuess);
$("next-button").addEventListener("click", nextRound);
$("zoom-in").addEventListener("click", () => globe.zoomIn());
$("zoom-out").addEventListener("click", () => globe.zoomOut());
$("play-button").addEventListener("click", () => start("daily"));
$("intro-practice-button").addEventListener("click", () => start("practice"));
$("practice-button").addEventListener("click", () => start("practice"));
$("daily-results-button").addEventListener("click", () => start("daily"));
$("help-button").addEventListener("click", () => showIntro({ help: Boolean(game && game.phase !== "done") }));
$("intro-close").addEventListener("click", () => { $("intro").hidden = true; });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("intro").hidden && !$("intro-close").hidden) $("intro").hidden = true;
});

// ---------- Accounts & friends ----------

let user = null;
let profile = null;
let socialError = false;
let recovering = false; // showing the "new password" form after a reset link

const PROVIDER_LABELS = { google: "Continue with Google", apple: "Continue with Apple" };
const PROVIDER_ICONS = {
  google: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.8h3.6c2.1-1.9 3.3-4.8 3.3-8.1z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10l3.7-2.9z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z"/></svg>',
  apple: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7a4.5 4.5 0 0 0-3.5-1.9c-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8a4.7 4.7 0 0 0-4 2.4c-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4a10 10 0 0 0 1.4-2.8 4.3 4.3 0 0 1-2.6-3.9zM14 5.5A4.3 4.3 0 0 0 15 2.4a4.4 4.4 0 0 0-2.9 1.5 4.1 4.1 0 0 0-1 3c1.1.1 2.2-.5 2.9-1.4z"/></svg>',
};

function accountMessage(text, isError = false) {
  const el = $("account-message");
  el.textContent = text;
  el.classList.toggle("is-error", isError);
}

const errorText = (error) => (error && error.message) || "Something went wrong. Please try again.";

function updateAccountButton() {
  const button = $("account-button");
  const initial = $("account-initial");
  const name = profile ? profile.display_name || profile.username : "";
  button.setAttribute("aria-label", user ? `Account: ${name || "signed in"}` : "Sign in");
  button.classList.toggle("is-signed-in", Boolean(user));
  initial.hidden = !user;
  button.querySelector(".icon-person").style.display = user ? "none" : "";
  initial.textContent = name ? name.trim().charAt(0).toUpperCase() : "·";
}

// Saves today's finished daily game to the account (once; the server ignores repeats).
async function syncDaily() {
  if (!user || !dailyDone()) return;
  try {
    await social.saveGame(user.id, { date: today, number: todayNumber, rounds: daily.rounds, total: totalScore(daily.rounds) });
  } catch (error) {
    console.error(error);
  }
}

function personRow(person, { action, label }) {
  const li = document.createElement("li");
  const who = document.createElement("div");
  const name = document.createElement("p");
  name.className = "person-name";
  name.textContent = person.display_name || person.username;
  const handle = document.createElement("p");
  handle.className = "person-handle";
  handle.textContent = `@${person.username}`;
  who.append(name, handle);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip-button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await action(person);
    } catch (error) {
      accountMessage(errorText(error), true);
      button.disabled = false;
    }
  });
  li.append(who, button);
  return li;
}

async function renderFollowing() {
  const list = $("following-list");
  const people = await social.listFollowing(user.id);
  list.replaceChildren(...people.map((person) => personRow(person, {
    label: "Unfollow",
    action: async (p) => { await social.unfollow(user.id, p.id); await renderFollowing(); },
  })));
  $("following-empty").hidden = people.length > 0;
  return people;
}

let searchTimer;
async function runSearch() {
  const query = $("people-search").value;
  const results = $("people-results");
  if (query.trim().length < 2) {
    results.replaceChildren();
    return;
  }
  const [found, following] = await Promise.all([social.searchProfiles(query, user.id), social.listFollowing(user.id)]);
  const followingIds = new Set(following.map((p) => p.id));
  results.replaceChildren(...found.map((person) => personRow(person, followingIds.has(person.id)
    ? { label: "Following", action: async () => {} }
    : { label: "Follow", action: async (p) => { await social.follow(user.id, p.id); await Promise.all([renderFollowing(), runSearch()]); } })));
}

async function renderAccount() {
  if (recovering) return;
  $("account-signed-out").hidden = Boolean(user);
  $("account-signed-in").hidden = !user;
  if (!user) return;
  $("account-name").textContent = profile ? profile.display_name || profile.username : "";
  $("account-handle").textContent = profile ? `@${profile.username}` : "";
  if (profile) {
    $("display-name").value = profile.display_name || "";
    $("username").value = profile.username;
  }
  try {
    const [stats] = await Promise.all([social.getStats(user.id), renderFollowing()]);
    $("acct-played").textContent = formatNumber(stats ? stats.played : 0);
    $("acct-streak").textContent = formatNumber(stats ? stats.current_streak : 0);
    $("acct-best").textContent = formatNumber(stats ? stats.best : 0);
    $("acct-average").textContent = formatNumber(stats ? stats.average : 0);
  } catch (error) {
    accountMessage(errorText(error), true);
  }
}

function openAccount() {
  accountMessage(socialError ? "Sign-in couldn't load. Check your connection and refresh the page." : "", socialError);
  document.querySelectorAll("#provider-buttons button, #email-form button").forEach((b) => { b.disabled = socialError; });
  renderAccount();
  openOverlay($("account"));
}

async function renderFriends(practice) {
  const section = $("friends");
  section.hidden = practice || !social.socialEnabled();
  if (section.hidden) return;
  $("friends-signin").hidden = Boolean(user);
  $("friends-list").replaceChildren();
  $("friends-empty").hidden = true;
  if (!user) return;
  try {
    const rows = await social.friendsResults(user.id, today);
    const others = rows.filter((r) => r.user_id !== user.id);
    $("friends-list").replaceChildren(...rows.map((row) => {
      const li = document.createElement("li");
      if (row.user_id === user.id) li.className = "is-you";
      const name = document.createElement("span");
      name.className = "friend-name";
      name.textContent = row.user_id === user.id ? "You" : (row.profiles && (row.profiles.display_name || row.profiles.username)) || "Player";
      const tiers = document.createElement("span");
      tiers.className = "friend-tiers";
      tiers.setAttribute("aria-hidden", "true");
      for (const r of row.rounds || []) {
        const dot = TIERS[r.tier] ? tierDot(r.tier) : document.createElement("span");
        tiers.append(dot);
      }
      const total = document.createElement("span");
      total.className = "friend-total";
      total.textContent = formatNumber(row.total);
      li.append(name, tiers, total);
      return li;
    }));
    $("friends-empty").hidden = others.length > 0;
  } catch (error) {
    console.error(error);
  }
}

async function onSignedIn(nextUser) {
  user = nextUser;
  profile = null;
  if (user) {
    try {
      profile = await social.getProfile(user.id);
    } catch (error) {
      console.error(error);
    }
    await syncDaily();
  }
  updateAccountButton();
  if (!$("account").hidden) renderAccount();
  if (!$("end").hidden && game) renderFriends(game.mode === "practice");
}

// Only offers methods that are both listed in config.js and switched on in
// Supabase, so nobody lands on a "provider is not enabled" error page.
function buildProviderButtons(enabled) {
  const container = $("provider-buttons");
  container.replaceChildren();
  $("email-form").hidden = true;
  for (const provider of AUTH_PROVIDERS) {
    if (enabled && !enabled[provider]) continue;
    if (provider === "email") {
      $("email-form").hidden = false;
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = `provider-button provider-${provider}`;
    button.innerHTML = `${PROVIDER_ICONS[provider] || ""}<span>${PROVIDER_LABELS[provider] || provider}</span>`;
    button.addEventListener("click", async () => {
      button.disabled = true;
      accountMessage("Redirecting…");
      try {
        await social.signInWithProvider(provider);
      } catch (error) {
        accountMessage(errorText(error), true);
        button.disabled = false;
      }
    });
    container.append(button);
  }
}

async function bootSocial() {
  if (!social.socialEnabled()) return;
  $("account-button").hidden = false;
  buildProviderButtons();
  social.enabledProviders().then(buildProviderButtons);
  try {
    await social.initSocial();
    social.onAuthChange((next, event) => {
      if (event === "PASSWORD_RECOVERY") showRecovery();
      if ((next && next.id) !== (user && user.id)) onSignedIn(next);
    });
    await onSignedIn(await social.currentUser());
  } catch (error) {
    // Keep the button so the problem is visible rather than silently missing.
    console.error(error);
    socialError = true;
  }
}

$("account-button").addEventListener("click", openAccount);
$("friends-signin").addEventListener("click", openAccount);
$("account-close").addEventListener("click", () => { $("account").hidden = true; });
// ---------- Email & password ----------

const AUTH_ERRORS = {
  invalid_credentials: "That email and password don't match. Try again, or create an account.",
  user_already_exists: "There's already an account with that email. Sign in instead.",
  email_not_confirmed: "Confirm your email first, using the link we sent you.",
  weak_password: "Choose a longer password (at least 8 characters).",
  over_email_send_rate_limit: "Too many emails sent. Please try again later.",
};
const authError = (error) => AUTH_ERRORS[error && error.code] || errorText(error);

function readCredentials({ needPassword = true } = {}) {
  const email = $("email-input").value.trim();
  const password = $("password-input").value;
  if (!$("email-input").checkValidity() || !email) {
    accountMessage("Please enter a valid email address.", true);
    return null;
  }
  if (needPassword && password.length < 8) {
    accountMessage("Passwords are at least 8 characters.", true);
    return null;
  }
  return { email, password };
}

async function withBusy(button, work) {
  button.disabled = true;
  try {
    await work();
  } catch (error) {
    accountMessage(authError(error), true);
  } finally {
    button.disabled = false;
  }
}

$("email-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const creds = readCredentials();
  if (!creds) return;
  accountMessage("Signing in…");
  withBusy($("password-sign-in"), async () => {
    await social.signInWithPassword(creds.email, creds.password);
    $("password-input").value = "";
    accountMessage("");
  });
});

$("password-sign-up").addEventListener("click", () => {
  const creds = readCredentials();
  if (!creds) return;
  accountMessage("Creating your account…");
  withBusy($("password-sign-up"), async () => {
    const signedIn = await social.signUp(creds.email, creds.password);
    $("password-input").value = "";
    accountMessage(signedIn ? "" : `Almost there: confirm your email using the link sent to ${creds.email}.`);
  });
});

$("password-forgot").addEventListener("click", () => {
  const creds = readCredentials({ needPassword: false });
  if (!creds) return;
  withBusy($("password-forgot"), async () => {
    await social.sendPasswordReset(creds.email);
    accountMessage(`If there's an account for ${creds.email}, a reset link is on its way.`);
  });
});

// Opened from a password-reset email: ask for a new password.
function showRecovery() {
  recovering = true;
  $("account-signed-out").hidden = true;
  $("account-signed-in").hidden = true;
  $("recovery-form").hidden = false;
  accountMessage("");
  openOverlay($("account"));
  $("new-password").focus();
}

$("recovery-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const password = $("new-password").value;
  if (password.length < 8) {
    accountMessage("Passwords are at least 8 characters.", true);
    return;
  }
  withBusy($("recovery-form").querySelector("button"), async () => {
    await social.updatePassword(password);
    $("new-password").value = "";
    $("recovery-form").hidden = true;
    recovering = false;
    await renderAccount();
    accountMessage("Password updated. You're signed in.");
  });
});

$("profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = $("username").value.trim().toLowerCase();
  const displayName = $("display-name").value.trim();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    accountMessage("Usernames are 3–20 lowercase letters, numbers or _.", true);
    return;
  }
  try {
    profile = await social.updateProfile(user.id, { username, displayName });
    updateAccountButton();
    renderAccount();
    accountMessage("Profile saved.");
  } catch (error) {
    accountMessage(error && error.code === "23505" ? "That username is taken." : errorText(error), true);
  }
});
$("people-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch().catch((e) => accountMessage(errorText(e), true)), 250);
});
$("sign-out").addEventListener("click", async () => {
  await social.signOut();
  await onSignedIn(null);
  accountMessage("Signed out.");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("account").hidden) $("account").hidden = true;
});

// ---------- Boot ----------

async function boot() {
  const poolReady = loadPool();
  globe = await createGlobe($("globe"), { onTap: onGlobeTap, reducedMotion, colors: globeColors() });
  await poolReady;
  window.tapmapReady = true;
  updateHeader();
  bootSocial();
  if (daily.rounds.length > 0) start("daily");
  else showIntro();
}

boot().catch((error) => {
  console.error(error);
  $("load-error").hidden = false;
});
