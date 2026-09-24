import { LOCATIONS } from "./locations.js";
import {
  ROUNDS, ROUND_PLAN, MAX_SCORE, GAME_URL,
  utcDateKey, gameNumber, msUntilNextGame,
  dailyLocations, practiceLocations, evaluateGuess, totalScore,
  rating, formatNumber, shareText,
  recordDailyResult, currentStreak,
} from "./game.js";
import { createGlobe, createSummaryGlobe } from "./map.js";

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

// ---------- Theme ----------

const themeToggle = $("theme-toggle");
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const activeTheme = () => root.getAttribute("data-theme") || (systemDark.matches ? "dark" : "light");

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

function syncTheme() {
  const theme = activeTheme();
  root.setAttribute("data-active-theme", theme);
  themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  const colors = globeColors();
  if (globe) globe.setColors(colors);
  if (summary) summary.setColors(colors);
}

themeToggle.addEventListener("click", () => {
  const next = activeTheme() === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch (e) {}
  syncTheme();
});
systemDark.addEventListener("change", syncTheme);

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
const todaysLocations = dailyLocations(today, LOCATIONS);

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
  return { mode, locations: practiceLocations(LOCATIONS), rounds: [], index: 0, phase: "guessing", guess: null };
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

  startCountdown();
  openOverlay($("end"));
  animateCount($("final-points"), 0, total, 1100);

  if (summary) summary.destroy();
  summary = null;
  try {
    summary = await createSummaryGlobe($("summary-globe"), rounds, { colors: globeColors(), reducedMotion });
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

// ---------- Boot ----------

async function boot() {
  syncTheme();
  globe = await createGlobe($("globe"), { onTap: onGlobeTap, reducedMotion, colors: globeColors() });
  window.tapmapReady = true;
  updateHeader();
  if (daily.rounds.length > 0) start("daily");
  else showIntro();
}

boot().catch((error) => {
  console.error(error);
  $("load-error").hidden = false;
});
