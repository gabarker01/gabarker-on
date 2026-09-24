import { LOCATIONS } from "./locations.js";
import {
  ROUNDS, MAX_SCORE, GAME_URL,
  utcDateKey, gameNumber, msUntilNextGame,
  dailyLocations, practiceLocations, evaluateGuess, totalScore,
  ratingFor, formatNumber, formatDistance, shareText,
  recordDailyResult, currentStreak,
} from "./game.js";
import { createMap, drawSummaryMap } from "./map.js";

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Storage (never required for the game to work) ----------

const storage = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  },
};

const DAILY_KEY = "tapmap:v1:daily";
const STATS_KEY = "tapmap:v1:stats";

// ---------- Theme ----------

const themeToggle = $("theme-toggle");
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const activeTheme = () => root.getAttribute("data-theme") || (systemDark.matches ? "dark" : "light");
const syncTheme = () => {
  const theme = activeTheme();
  root.setAttribute("data-active-theme", theme);
  themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
};
themeToggle.addEventListener("click", () => {
  const next = activeTheme() === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch (e) {}
  syncTheme();
});
systemDark.addEventListener("change", syncTheme);
syncTheme();

// ---------- Helpers ----------

const toLngLat = (loc) => ({ lat: loc.lat, lng: loc.lng });

function animateCount(el, from, to, duration = 700) {
  if (reducedMotion || from === to) {
    el.textContent = formatNumber(to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      el.textContent = formatNumber(from + (to - from) * eased);
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
let map = null;
let world = null;

const dailyDone = () => daily.rounds.length >= ROUNDS;

function newGame(mode) {
  if (mode === "daily") {
    return { mode, locations: todaysLocations, rounds: daily.rounds, index: daily.rounds.length, phase: "guessing", guess: null };
  }
  return { mode, locations: practiceLocations(LOCATIONS), rounds: [], index: 0, phase: "guessing", guess: null };
}

// ---------- Header ----------

function updateHeader(totalOverride) {
  $("game-label").textContent = game && game.mode === "practice" ? "Practice" : `Daily #${todayNumber}`;
  if (!game || game.phase === "done") {
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
  game.phase = "guessing";
  game.guess = null;

  $("prompt-round").textContent = `Round ${game.index + 1} of ${ROUNDS}`;
  const difficulty = $("prompt-difficulty");
  difficulty.textContent = location.difficulty;
  difficulty.className = `difficulty difficulty-${location.difficulty}`;
  $("prompt-name").textContent = location.name;
  $("prompt-hint").textContent = location.hint;
  $("prompt-hint").hidden = true;
  $("hint-button").hidden = false;
  $("hint-button").setAttribute("aria-expanded", "false");

  // Restart the card animation for each round.
  prompt.hidden = true;
  void prompt.offsetWidth;
  prompt.hidden = false;

  actionBar.hidden = false;
  $("tap-help").hidden = false;
  confirmButton.hidden = false;
  confirmButton.disabled = true;
  result.hidden = true;

  updateHeader();
  map.reset();
}

function onMapTap(lnglat) {
  if (!game || game.phase !== "guessing") return;
  game.guess = lnglat;
  map.setGuess(lnglat);
  confirmButton.disabled = false;
  $("tap-help").hidden = true;
}

// Space the map leaves free around the floating cards, for fitting the view.
function mapPadding() {
  const stage = $("map").getBoundingClientRect();
  const promptRect = prompt.getBoundingClientRect();
  const barRect = actionBar.getBoundingClientRect();
  return {
    top: Math.max(24, promptRect.bottom - stage.top + 24),
    bottom: Math.max(24, stage.bottom - barRect.top + 24),
    left: 32,
    right: 84,
  };
}

async function confirmGuess() {
  if (!game || game.phase !== "guessing" || !game.guess) return;
  game.phase = "revealing";
  const location = game.locations[game.index];
  const answer = toLngLat(location);
  const round = { ...evaluateGuess(game.guess, answer), answer };
  const before = totalScore(game.rounds);
  game.rounds.push(round);
  if (game.mode === "daily") saveDaily();

  // Swap the confirm button for the result card before fitting, so the fit
  // leaves room for it.
  confirmButton.hidden = true;
  $("tap-help").hidden = true;
  $("result-tier").textContent = round.tier;
  $("result-distance").textContent = formatDistance(round.distanceKm);
  $("result-answer").textContent = location.name;
  $("result-points").textContent = "0";
  $("result-bonus").hidden = true;
  const isLast = game.index === ROUNDS - 1;
  $("next-button").textContent = isLast ? "See results" : "Next round";
  $("next-button").disabled = true;
  result.hidden = false;

  await map.reveal(game.guess, answer, mapPadding());

  const counting = animateCount($("result-points"), 0, round.total);
  const tallyStart = performance.now();
  const tallyTick = (now) => {
    const t = reducedMotion ? 1 : Math.min(1, (now - tallyStart) / 700);
    updateHeader(before + round.total * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(tallyTick);
  };
  requestAnimationFrame(tallyTick);
  await counting;

  if (round.bullseye) {
    const bonus = $("result-bonus");
    bonus.textContent = round.bonus > 0
      ? `🎯 Bullseye! Within 25 km · +${round.bonus} bonus`
      : "🎯 Bullseye! Within 25 km · maxed out at 1,000";
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
    const stats = recordDailyResult(storage.get(STATS_KEY) || {}, today, totalScore(daily.rounds));
    storage.set(STATS_KEY, stats);
  }
}

// ---------- End screen ----------

let countdownTimer;

function finishGame() {
  game.phase = "done";
  prompt.hidden = true;
  actionBar.hidden = true;
  updateHeader();
  showEnd(game);
}

function showEnd(finished) {
  const rounds = finished.rounds;
  const total = totalScore(rounds);
  const practice = finished.mode === "practice";

  $("end-label").textContent = practice ? "Practice round" : `TapMap #${todayNumber} · ${today}`;
  $("end-rating").textContent = ratingFor(total);
  $("end-emoji").textContent = rounds.map((r) => r.tier).join("");
  $("final-points").textContent = "0";

  const list = $("breakdown");
  list.replaceChildren(...rounds.map((r, i) => {
    const li = document.createElement("li");
    const tier = document.createElement("span");
    tier.className = "breakdown-tier";
    tier.textContent = r.tier;
    const info = document.createElement("div");
    const name = document.createElement("p");
    name.className = "breakdown-name";
    name.textContent = finished.locations[i].name;
    const distance = document.createElement("p");
    distance.className = "breakdown-distance";
    distance.textContent = formatDistance(r.distanceKm) + (r.bullseye ? " · 🎯 bonus" : "");
    info.append(name, distance);
    const score = document.createElement("p");
    score.className = "breakdown-score";
    score.textContent = formatNumber(r.total);
    li.append(tier, info, score);
    return li;
  }));

  drawSummaryMap($("summary-map"), world, rounds);

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
    toast((await copyText(text)) ? "Copied!" : "Couldn't copy. Try again.");
  };
  const shareButton = $("share-button");
  shareButton.hidden = !navigator.share;
  shareButton.onclick = () => navigator.share({ text }).catch(() => {});

  startCountdown();
  openOverlay($("end"));
  animateCount($("final-points"), 0, total, 1000);
}

function startCountdown() {
  clearInterval(countdownTimer);
  const el = $("next-game");
  const tick = () => {
    const ms = msUntilNextGame();
    if (utcDateKey() !== today) {
      el.textContent = "A new TapMap is ready. Refresh to play.";
      clearInterval(countdownTimer);
      return;
    }
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    el.textContent = `Next TapMap in ${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// ---------- Starting games ----------

function start(mode) {
  $("intro").hidden = true;
  $("end").hidden = true;
  clearInterval(countdownTimer);
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
  $("intro-number").textContent = `TapMap #${todayNumber}`;
  $("play-button").textContent = dailyDone()
    ? "See today's result"
    : partial ? "Continue today's game" : "Play today's game";
  $("play-button").hidden = help;
  $("intro-practice-button").hidden = help;
  $("intro-close").hidden = !help;
  openOverlay($("intro"));
}

// ---------- Wiring ----------

$("hint-button").addEventListener("click", () => {
  $("prompt-hint").hidden = false;
  $("hint-button").hidden = true;
  $("hint-button").setAttribute("aria-expanded", "true");
});
confirmButton.addEventListener("click", confirmGuess);
$("next-button").addEventListener("click", nextRound);
$("zoom-in").addEventListener("click", () => map.zoomBy(2));
$("zoom-out").addEventListener("click", () => map.zoomBy(0.5));
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
  const response = await fetch("world-110m.json?v=1");
  if (!response.ok) throw new Error(`World map failed to load (${response.status})`);
  world = await response.json();
  map = createMap($("map"), world, { onTap: onMapTap, reducedMotion });
  window.tapmapReady = true;
  updateHeader();

  if (dailyDone()) start("daily");
  else if (daily.rounds.length > 0) start("daily");
  else showIntro();
}

boot().catch((error) => {
  console.error(error);
  $("load-error").hidden = false;
});
