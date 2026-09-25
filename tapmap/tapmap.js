import { LOCATIONS } from "./locations.js?v=4";
import { PHOTO_PLACES } from "./photo-places.js?v=1";
import {
  ROUNDS, ROUND_PLAN, PHOTO_PLAN, GAME_URL, BULLSEYE_KM,
  todayKey, gameNumber, dateForNumber, weekStart, msUntilNextGame,
  dailyLocations, practiceLocations, poolFor, evaluateGuess, totalScore, maxScoreFor,
  ratingFor, tierFor, formatNumber, shareText,
  recordDailyResult, currentStreak,
  encodeChallenge, decodeChallenge, resolvePlaces, placeCode,
} from "./game.js?v=8";
import { createGlobe, createSummaryGlobe } from "./map.js?v=10";
import { AUTH_PROVIDERS } from "./config.js?v=3";
import * as social from "./social.js?v=15";
import { initials, colourFor, avatarElement } from "./avatar.js?v=2";
import { landmarkPhoto, photoCredit } from "./photo.js?v=1";
import { satellitePhoto } from "./satellite.js?v=2";
import { drawShareImage } from "./share-image.js?v=1";

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

// Version 5 adds today's five places to the saved daily game. Version 4 data
// is copied across once and left in place, so an older open tab still works.
const DAILY_KEY = "tapmap:v5:daily"; // { date, number, locations, rounds }
const STATS_KEY = "tapmap:v5:stats";
const ARCHIVE_KEY = "tapmap:v5:archive"; // { [game number]: { locations, rounds } }
const CHALLENGES_KEY = "tapmap:v5:challenges"; // { [challenge key]: { locations, rounds } }
const CHALLENGE_KEY = "tapmap:v5:challenge"; // the last challenge opened: a link code, or { id, ch }
const CHALLENGE_RESULTS_KEY = "tapmap:v5:challenge-results"; // { [challenge id]: { rounds, total, saved } }
const CREATED_CHALLENGES_KEY = "tapmap:v5:created-challenges"; // { [challenge id]: { at } } made on this device
const LEGACY_DAILY_KEY = "tapmap:v4:daily";
const LEGACY_STATS_KEY = "tapmap:v4:stats";

function migrateStorage() {
  if (storage.get(STATS_KEY) === null && storage.get(LEGACY_STATS_KEY)) {
    storage.set(STATS_KEY, storage.get(LEGACY_STATS_KEY));
  }
  const legacy = storage.get(LEGACY_DAILY_KEY);
  if (storage.get(DAILY_KEY) === null && legacy && Array.isArray(legacy.rounds)) {
    // The places weren't saved in version 4; they're filled in when the game resumes.
    // Tiers are recalculated because 🎯 now means under 25 km (it was 50).
    const rounds = legacy.rounds.map((r) => (Number.isFinite(r.distanceKm) ? { ...r, tier: tierFor(r.distanceKm) } : r));
    storage.set(DAILY_KEY, { date: legacy.date, number: gameNumber(legacy.date), locations: null, rounds });
  }
}
migrateStorage();

// ---------- Formatting ----------

const KM_PER_MILE = 1.609344;
const TIERS = {
  "🎯": { cls: "t-bullseye", label: `Within ${BULLSEYE_KM} km` },
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
const longDateOf = (dateKey) => new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-GB", {
  weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
});
const shortDateOf = (dateKey) => new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-GB", {
  weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
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

function imageColors() {
  const css = getComputedStyle(root);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    ink: v("--ink"),
    soft: v("--ink-soft"),
    faint: v("--ink-faint"),
    accent: v("--accent"),
    ocean: v("--globe-ocean"),
    land: "#3a4658",
    atmosphere: v("--globe-atmosphere"),
    tiers: Object.fromEntries(Object.entries(TIERS).map(([tier, t]) => [tier, v(`--${t.cls}`)])),
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

const today = todayKey();
const todayNumber = gameNumber(today);
// The whole location list (with each place's added and retired dates) comes
// from the database when it can be reached, otherwise from the built-in list.
let allLocations = LOCATIONS;
// Photo practice has its own places, picked for how recognisable the photo is.
let photoPlaces = PHOTO_PLACES;

const hasEnoughFor = (locations) =>
  ["easy", "medium", "hard"].every((level) =>
    locations.filter((l) => l.difficulty === level).length >= ROUND_PLAN.filter((r) => r.difficulty === level).length);

// The built-in list's fact and photo article for each place, by name. The
// database's copy wins, but where it's empty (e.g. before setup.sql has been
// re-run) the built-in one is used, and places saved on the device before
// facts existed get them too.
const BUILT_IN = new Map([...PHOTO_PLACES, ...LOCATIONS].map((l) => [l.name, l]));
const withDetails = (l) => {
  const known = BUILT_IN.get(l.name);
  if (!known) return l;
  const notes = (l.notes && String(l.notes).trim()) || known.notes || null;
  const photo = (l.photo && String(l.photo).trim()) || known.photo || null;
  return notes === l.notes && photo === l.photo ? l : { ...l, notes, photo };
};

async function loadPool() {
  try {
    const rows = await social.fetchLocations();
    const valid = (rows || []).filter((r) =>
      r && typeof r.name === "string" && Number.isFinite(r.lat) && Number.isFinite(r.lng) && ["easy", "medium", "hard"].includes(r.difficulty));
    if (hasEnoughFor(poolFor(today, valid))) allLocations = valid.map(withDetails);
  } catch (error) {
    console.warn("Using the built-in location list:", error);
  }
}

async function loadPhotoPlaces() {
  try {
    const rows = await social.fetchPhotoPlaces();
    const valid = (rows || []).filter((r) =>
      r && typeof r.name === "string" && typeof r.photo === "string" && Number.isFinite(r.lat) && Number.isFinite(r.lng) && ["easy", "medium", "hard"].includes(r.difficulty));
    if (hasEnoughFor(poolFor(today, valid))) photoPlaces = valid.map(withDetails);
  } catch (error) {
    console.warn("Using the built-in photo places:", error);
  }
}

// What's saved about each place: enough to replay it without the list.
const snapshot = (l) => ({ name: l.name, lat: l.lat, lng: l.lng, difficulty: l.difficulty, notes: l.notes || null, photo: l.photo || null });
const validPlaces = (list) => Array.isArray(list) && list.length === ROUNDS
  && list.every((l) => l && typeof l.name === "string" && Number.isFinite(l.lat) && Number.isFinite(l.lng));
// Places saved on the device, with any missing fact or photo filled in.
const savedPlaces = (list) => list.map(withDetails);

function loadDaily() {
  const saved = storage.get(DAILY_KEY);
  return saved && saved.date === today && Array.isArray(saved.rounds)
    ? { date: today, number: todayNumber, locations: validPlaces(saved.locations) ? savedPlaces(saved.locations) : null, rounds: saved.rounds }
    : { date: today, number: todayNumber, locations: null, rounds: [] };
}

let daily = loadDaily();
let game = null; // { mode, plan, number, dateKey, locations, rounds, index, phase, guess, nameShown, challenge }

const dailyDone = () => daily.rounds.length >= ROUNDS;

// Today's five places, fixed on this device from the moment they're first
// used, so reaching the database (or not), or a place being added, can't
// change them partway through the day.
function todaysPlaces() {
  if (!daily.locations) {
    daily.locations = dailyLocations(today, allLocations).map(snapshot);
    storage.set(DAILY_KEY, daily);
  }
  return daily.locations;
}

// Past games and challenges: unranked, saved on this device only.
const savedMap = (key) => storage.get(key) || {};
function saveInMap(key, id, value, keep = 60) {
  const map = savedMap(key);
  delete map[id];
  map[id] = value;
  const ids = Object.keys(map);
  ids.slice(0, Math.max(0, ids.length - keep)).forEach((old) => { delete map[old]; });
  storage.set(key, map);
}

function newGame(mode, options = {}) {
  const base = { mode, plan: ROUND_PLAN, rounds: [], index: 0, phase: "guessing", guess: null, nameShown: false, challenge: options.challenge || null, sendAsChallenge: options.sendAsChallenge || null };
  if (mode === "daily") {
    return { ...base, number: todayNumber, dateKey: today, locations: todaysPlaces(), rounds: daily.rounds, index: daily.rounds.length };
  }
  if (mode === "archive") {
    const number = options.number;
    const saved = savedMap(ARCHIVE_KEY)[number];
    const dateKey = dateForNumber(number);
    const locations = saved && validPlaces(saved.locations)
      ? savedPlaces(saved.locations)
      : dailyLocations(dateKey, allLocations).map(snapshot);
    const rounds = saved && Array.isArray(saved.rounds) ? saved.rounds : [];
    return { ...base, number, dateKey, locations, rounds, index: rounds.length };
  }
  if (mode === "challenge") {
    const saved = savedMap(CHALLENGES_KEY)[options.code];
    const rounds = saved && Array.isArray(saved.rounds) ? saved.rounds : [];
    return { ...base, plan: options.plan, code: options.code, locations: options.locations, rounds, index: rounds.length };
  }
  const pool = poolFor(today, allLocations);
  if (mode === "photo") {
    const photoPool = poolFor(today, photoPlaces);
    const from = hasEnoughFor(photoPool) ? photoPool : pool;
    return { ...base, plan: PHOTO_PLAN, locations: practiceLocations(from, Math.random, PHOTO_PLAN).map(snapshot) };
  }
  return { ...base, locations: practiceLocations(pool).map(snapshot) };
}

function saveProgress() {
  if (game.mode === "daily") saveDaily();
  else if (game.mode === "archive") saveInMap(ARCHIVE_KEY, game.number, { locations: game.locations, rounds: game.rounds }, 400);
  else if (game.mode === "challenge") saveInMap(CHALLENGES_KEY, game.code, { locations: game.locations, rounds: game.rounds });
}

const MODE_LABELS = { practice: "Practice", photo: "Photos", challenge: "Challenge" };
const gameLabel = (g) => {
  if (!g || g.mode === "daily") return `No. ${todayNumber}`;
  if (g.mode === "archive") return `No. ${g.number} · Past game`;
  return MODE_LABELS[g.mode];
};

// ---------- Header ----------

function updateHeader(totalOverride) {
  $("game-label").textContent = gameLabel(game);
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
let photo = null; // the current photo { url, revoke, file?, page? }
let photoToken = 0;

// The photo can be minimised to a thumbnail, so the question panel
// is about the size of a normal one and more of the globe is free to tap.
// The choice is remembered for the next rounds.
const PHOTO_MIN_KEY = "tapmap:v5:photo-min";
function setPhotoMinimised(min) {
  prompt.classList.toggle("is-photo-min", min);
  $("photo-size").textContent = min ? "Show larger photo" : "Minimise photo";
  $("photo-frame").setAttribute("aria-label", min ? "Show a larger photo" : "Minimise the photo");
  storage.set(PHOTO_MIN_KEY, min);
}
const togglePhoto = () => setPhotoMinimised(!prompt.classList.contains("is-photo-min"));

function clearPhoto() {
  photoToken += 1;
  if (photo) photo.revoke();
  photo = null;
  $("prompt-photo").hidden = true;
  $("photo-size").hidden = true;
  $("prompt-img").removeAttribute("src");
  prompt.classList.remove("is-photo-min");
}

// Photo rounds show only a photo of the landmark; the name appears once
// you've guessed. If the place has no usable photo, a satellite view is shown
// instead, and if that can't load either, the name.
function showName(location) {
  game.nameShown = true;
  $("prompt-name").textContent = location.name;
  $("prompt-name").classList.remove("is-hidden");
}

function showPhoto(location) {
  const token = ++photoToken;
  $("prompt-name").textContent = "Where is this?";
  $("prompt-name").classList.add("is-hidden");
  $("prompt-photo").hidden = false;
  $("photo-size").hidden = false;
  setPhotoMinimised(Boolean(storage.get(PHOTO_MIN_KEY)));
  $("prompt-photo-status").hidden = false;
  $("prompt-photo-status").textContent = "Loading photo…";
  $("prompt-img").hidden = true;
  landmarkPhoto(location).catch((error) => {
    console.warn("Landmark photo:", error);
    return satellitePhoto(location);
  }).then((next) => {
    if (token !== photoToken) return next.revoke();
    photo = next;
    $("prompt-img").src = next.url;
    $("prompt-img").hidden = false;
    $("prompt-photo-status").hidden = true;
  }).catch((error) => {
    if (token !== photoToken) return;
    console.warn(error);
    clearPhoto();
    showName(location);
    toast("The photo couldn't load, so here's the name.");
  });
}

// Wikimedia photos need their author and licence credited: shown once the
// round is answered (it would give the answer away before).
function showPhotoCredit() {
  const el = $("photo-credit");
  const current = photo;
  el.replaceChildren();
  el.hidden = !current;
  if (!current) return;
  if (!current.file) {
    el.textContent = "Satellite imagery © Esri, Maxar, Earthstar Geographics";
    return;
  }
  const link = document.createElement("a");
  link.href = current.page;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Wikimedia Commons";
  el.append("Photo via ", link);
  photoCredit(current.file).then((credit) => {
    if (photo !== current) return;
    link.href = credit.url;
    const who = [credit.artist, credit.license].filter(Boolean).join(", ");
    el.replaceChildren(`Photo${who ? `: ${who}` : ""}, via `, link);
  }).catch(() => {});
}

function showRound() {
  const location = game.locations[game.index];
  const plan = game.plan[game.index];
  game.phase = "guessing";
  game.guess = null;
  game.nameShown = false;
  clearPhoto();
  $("photo-credit").hidden = true;

  $("prompt-round").textContent = `Round ${ROMAN[game.index]}`;
  $("prompt-difficulty").textContent = capitalise(location.difficulty);
  $("prompt-multiplier").textContent = formatMultiplier(plan.multiplier);
  if (plan.photo) showPhoto(withDetails(location));
  else showName(location);

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
  // Friends may have finished since the last round; refresh their pins.
  if (game.mode === "daily" && user) loadFriendGames();
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

function bonusText(round) {
  const parts = [];
  if (round.bullseye) {
    parts.push(`Bullseye! Within ${BULLSEYE_KM} km: full marks.`);
  }
  return parts.join(" ");
}

async function confirmGuess() {
  if (!game || game.phase !== "guessing" || !game.guess) return;
  game.phase = "revealing";
  const location = game.locations[game.index];
  const plan = game.plan[game.index];
  const { multiplier } = plan;
  const answer = { lat: location.lat, lng: location.lng };
  const fromPhoto = Boolean(plan.photo) && !game.nameShown;
  const round = { ...evaluateGuess(game.guess, answer, multiplier, { photo: fromPhoto }), answer };
  const before = totalScore(game.rounds);
  game.rounds.push(round);
  saveProgress();

  // The name is revealed with the answer.
  $("prompt-name").textContent = location.name;
  $("prompt-name").classList.remove("is-hidden");

  // Show the result panel first so the fit leaves room for it.
  confirmButton.hidden = true;
  $("tap-help").hidden = true;
  $("result-km").textContent = formatLength(round.distanceKm);
  $("result-mi").textContent = `${formatLength(round.distanceKm / KM_PER_MILE)} mi`;
  $("result-tier").replaceChildren(tierDot(round.tier), document.createTextNode(TIERS[round.tier].label));
  $("result-maths").textContent = `${formatMultiplier(multiplier)} · ${formatPoints(round.weighted)} pts`;
  $("result-points").textContent = "0";
  const fact = withDetails(location).notes;
  $("result-fact").textContent = fact || "";
  $("result-fact").hidden = !fact;
  showPhotoCredit();
  $("result-bonus").hidden = true;
  $("next-button").textContent = game.index === ROUNDS - 1 ? "See your results" : "Next round";
  $("next-button").disabled = true;
  result.hidden = false;

  await globe.reveal(game.guess, answer, fitPadding(), friendsForRound(game.index));

  const counting = animateCount($("result-points"), 0, round.score);
  const tallyStart = performance.now();
  const tallyTick = (now) => {
    const t = reducedMotion ? 1 : Math.min(1, (now - tallyStart) / 700);
    updateHeader(before + round.weighted * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(tallyTick);
  };
  requestAnimationFrame(tallyTick);
  await counting;

  const bonus = bonusText(round);
  if (bonus) {
    $("result-bonus").textContent = bonus;
    $("result-bonus").hidden = false;
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

// Today's game being saved to the account, so the stats shown afterwards
// include it (otherwise the streak read back from the server is a day behind).
let dailySaving = null;

function saveDaily() {
  daily.rounds = game.rounds;
  storage.set(DAILY_KEY, daily);
  if (dailyDone()) {
    storage.set(STATS_KEY, recordDailyResult(storage.get(STATS_KEY) || {}, today, totalScore(daily.rounds)));
    if (user) dailySaving = syncDaily();
    else saveAnonymousDaily();
  }
}

// A random id for this device (no personal details), so games played
// without an account are counted once in the overall stats, and not again
// if they're later saved to an account.
const DEVICE_KEY = "tapmap:device";
function deviceId() {
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch (e) {}
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    id = crypto.randomUUID ? crypto.randomUUID()
      : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
    try { localStorage.setItem(DEVICE_KEY, id); } catch (e) {}
  }
  return id;
}

// Today's game without an account: counted in the overall stats (never on
// leaderboards). Once per day per device.
async function saveAnonymousDaily() {
  if (user || !dailyDone() || daily.anonSaved) return;
  try {
    await social.saveAnonymousGame(deviceId(), {
      date: today, number: todayNumber, rounds: daily.rounds, total: totalScore(daily.rounds),
      names: todaysPlaces().map((l) => l.name),
    });
    daily.anonSaved = true;
    storage.set(DAILY_KEY, daily);
  } catch (error) {
    console.warn("Game not counted yet:", error);
  }
}

// ---------- Challenges ----------

// Challenges are saved in the database and shared as /tapmap/challenge/{id}
// (that page's Play button opens /tapmap/?c={id}). Older links, and links made
// when the database can't be reached, look like /tapmap/?challenge=… and
// carry the places (as short codes) and the sender's rounds themselves.
// Either way they work without an account.
const challengeKind = (g) => (g.mode === "daily" || g.mode === "archive" ? "daily" : g.plan.some((r) => r.photo) ? "photo" : "practice");

function challengeLink(g) {
  const code = encodeChallenge({
    by: user && profile ? personName(profile) : null,
    username: user && profile ? profile.username : null,
    kind: challengeKind(g),
    number: g.number,
    places: g.locations.map((l) => l.name),
    rounds: g.rounds,
  });
  return `${GAME_URL}/?challenge=${code}`;
}

// The sender's rounds from a saved challenge, as full rounds for the results
// screen (your own challenge, opened on another device).
function roundsFromChallenge(ch, locations, plan) {
  return ch.rounds.map((r, i) => {
    const answer = { lat: locations[i].lat, lng: locations[i].lng };
    return {
      guess: r.guess || answer, answer, distanceKm: r.distanceKm, score: r.score, tier: r.tier,
      bullseye: r.distanceKm < BULLSEYE_KM, bonus: 0, sat: Boolean(plan[i].photo),
      multiplier: plan[i].multiplier, weighted: r.score * plan[i].multiplier,
    };
  });
}

// A challenge row from the database, in the same shape as a decoded link.
function challengeFromRow(row) {
  if (!row) return null;
  const places = Array.isArray(row.places) ? row.places : [];
  const rounds = Array.isArray(row.rounds) ? row.rounds : [];
  if (!validPlaces(places) || rounds.length !== ROUNDS || !["daily", "practice", "photo"].includes(row.kind)) return null;
  return {
    by: row.by_name || (row.profiles ? personName(row.profiles) : null),
    username: row.profiles ? row.profiles.username : null,
    avatarUrl: row.profiles ? row.profiles.avatar_url || null : null,
    createdBy: row.created_by || null,
    kind: row.kind,
    number: row.game_number || undefined,
    codes: places.map((l) => placeCode(l.name)),
    places,
    rounds: rounds.map((r) => ({
      score: r.score,
      distanceKm: r.km,
      tier: tierFor(r.km),
      guess: r.guess && Number.isFinite(r.guess.lat) && Number.isFinite(r.guess.lng) ? r.guess : null,
    })),
  };
}

// The last challenge opened on this device: { key, ch, id? }.
function openedChallengeEntry() {
  const saved = storage.get(CHALLENGE_KEY);
  if (typeof saved === "string") {
    const ch = decodeChallenge(saved);
    return ch ? { key: saved, ch } : null;
  }
  return saved && saved.id && saved.ch ? { key: `id:${saved.id}`, id: saved.id, ch: saved.ch } : null;
}

// What playing a challenge means here: today's daily, a past game, or the
// same five places as an unranked challenge. Null if the places are unknown.
function resolveChallenge(entry) {
  if (!entry) return null;
  const { ch, key: code, id } = entry;
  const plan = ch.kind === "photo" ? PHOTO_PLAN : ROUND_PLAN;
  const sameAs = (locations) => locations.every((l, i) => l && placeCode(l.name) === ch.codes[i]);
  if (ch.kind === "daily" && ch.number && ch.number <= todayNumber) {
    if (ch.number === todayNumber && sameAs(todaysPlaces())) return { ch, code, id, plan, mode: "daily", number: todayNumber };
    if (ch.number < todayNumber) {
      const saved = savedMap(ARCHIVE_KEY)[ch.number];
      const locations = saved && validPlaces(saved.locations) ? saved.locations : dailyLocations(dateForNumber(ch.number), allLocations);
      if (sameAs(locations)) return { ch, code, id, plan, mode: "archive", number: ch.number };
    }
  }
  // Saved challenges carry their places; link codes are looked up by name.
  const locations = ch.places ? savedPlaces(ch.places) : resolvePlaces(ch.codes, [...allLocations, ...photoPlaces]);
  if (!locations) return null;
  return { ch, code, id, plan, mode: "challenge", locations: locations.map(snapshot) };
}

const challengerName = (ch) => ch.by || "A friend";
const challengerTotal = ({ ch, plan }) =>
  Math.round(ch.rounds.reduce((sum, r, i) => sum + r.score * plan[i].multiplier, 0));

// Is this finished game the one the last opened challenge is about?
function challengeFor(g) {
  if (g.mode === "practice" || g.mode === "photo") return null;
  const resolved = resolveChallenge(openedChallengeEntry());
  if (!resolved || resolved.mode !== g.mode) return null;
  if (g.mode === "challenge") return resolved.code === g.code ? resolved : null;
  return resolved.number === g.number ? resolved : null;
}

// Everyone else who has played this saved challenge, for their pins.
let challengePlayers = { id: null, rows: [] };
function loadChallengePlayers(resolved) {
  if (!resolved || !resolved.id || challengePlayers.id === resolved.id) return;
  challengePlayers = { id: resolved.id, rows: [] };
  social.fetchChallengeResults(resolved.id)
    .then((rows) => { if (challengePlayers.id === resolved.id) challengePlayers.rows = rows || []; })
    .catch((error) => console.warn("Challenge players:", error));
}

function startChallenge(resolved) {
  $("challenge-invite").hidden = true;
  loadChallengePlayers(resolved);
  if (resolved.mode === "daily") start("daily", { challenge: resolved });
  else if (resolved.mode === "archive") start("archive", { number: resolved.number, challenge: resolved });
  else start("challenge", { code: resolved.code, plan: resolved.plan, locations: resolved.locations, challenge: resolved });
}

function offerChallenge() {
  if (!storage.get(CHALLENGE_KEY)) return false;
  const resolved = resolveChallenge(openedChallengeEntry());
  if (!resolved) {
    storage.set(CHALLENGE_KEY, null);
    toast("That challenge link doesn't work any more.");
    return false;
  }
  const { ch, plan } = resolved;
  const max = maxScoreFor(plan);
  const what = resolved.mode === "daily" ? "today's game"
    : resolved.mode === "archive" ? `TapMap No. ${resolved.number}`
      : ch.kind === "photo" ? "five places in photo practice" : "five practice places";
  const done = resolved.mode === "daily" ? dailyDone()
    : resolved.mode === "archive" ? ((savedMap(ARCHIVE_KEY)[resolved.number] || {}).rounds || []).length >= ROUNDS
      : ((savedMap(CHALLENGES_KEY)[resolved.code] || {}).rounds || []).length >= ROUNDS;
  $("challenge-title").textContent = `${challengerName(ch)} challenges you`;
  $("challenge-text").textContent = `${challengerName(ch)} scored ${formatNumber(challengerTotal(resolved))} of ${formatNumber(max)} on ${what}. `
    + (done ? "You've played it too. See how you compare, round by round."
      : `Play the same five places and compare, round by round.${resolved.mode === "daily" ? " It counts as today's game." : " It's unranked, and saved on this device only."}`);
  $("challenge-accept").textContent = done ? "See how you compare" : "Play the challenge";
  $("challenge-accept").onclick = () => startChallenge(resolved);
  $("challenge-skip").onclick = () => {
    $("challenge-invite").hidden = true;
    storage.set(CHALLENGE_KEY, null);
    if (!seenIntro()) showIntro();
    else start("daily");
  };
  openOverlay($("challenge-invite"));
  return true;
}

// Challenges are created on purpose: "Challenge" on someone's profile, or
// New challenge (your profile, the practice page), opens random places or
// photos with ?send=1 (and ?to=username for a player). When that game ends,
// it's saved as a challenge (and sent to that player's profile), and the
// results screen shows a big Share challenge button. Other games don't offer
// challenges.
let challengeIntent = null; // { target: { username, id? } | null } for the next game started

async function createChallengeFor(finished, total) {
  const target = finished.sendAsChallenge.target;
  try {
    if (target && user && !target.id) {
      const person = await social.getProfileByUsername(target.username).catch(() => null);
      if (person) target.id = person.id;
    }
    const id = await social.createChallenge({
      challengedUser: target && target.id,
      userId: user ? user.id : null,
      byName: user && profile ? personName(profile) : null,
      kind: challengeKind(finished),
      number: finished.number,
      places: finished.locations,
      rounds: finished.rounds,
      total,
    });
    finished.challengeUrl = `${GAME_URL}/challenge/${id}`;
    finished.challengeSent = Boolean(target && target.id);
    finished.challengeId = id;
    // Kept on this device, so opening the challenge link again shows these results.
    saveInMap(CHALLENGES_KEY, `id:${id}`, { locations: finished.locations, rounds: finished.rounds });
    saveInMap(CREATED_CHALLENGES_KEY, id, { at: Date.now() }, 200);
  } catch (error) {
    // If the database can't be reached, the challenge goes in the link itself.
    console.warn("Couldn't save the challenge, so it goes in the link:", error);
    finished.challengeUrl = challengeLink(finished);
  }
}

// A challenge's results screen, at /tapmap/challenge/{id}: Share challenge at
// the top, then your score and globe, the round-by-round comparison (if it
// was someone else's challenge) and everyone who has played it. For a game
// played to challenge someone (sendAsChallenge), the challenge is saved (and
// sent to that player's profile) first.
async function showChallengeReady(finished, total) {
  const block = $("challenge-ready");
  const isChallenge = Boolean(finished.sendAsChallenge || finished.challenge);
  block.hidden = !isChallenge;
  $("challenge-players").hidden = true;
  // Share challenge is the main button here; Copy result steps back.
  $("copy-button").classList.toggle("primary-button", !isChallenge);
  $("copy-button").classList.toggle("secondary-button", isChallenge);
  if (!isChallenge) return;
  const target = finished.sendAsChallenge && finished.sendAsChallenge.target;
  const button = $("challenge-share");
  const text = $("challenge-ready-text");
  button.disabled = true;
  button.textContent = "Getting your challenge ready…";
  text.textContent = "";
  if (finished.challenge) {
    // Someone's challenge you've played (or your own, opened again).
    finished.challengeId = finished.challenge.id || null;
    finished.challengeUrl ||= finished.challenge.id ? `${GAME_URL}/challenge/${finished.challenge.id}` : challengeLink(finished);
  } else if (!finished.challengeUrl) {
    if (!finished.challengeSaving) finished.challengeSaving = createChallengeFor(finished, total);
    await finished.challengeSaving;
  }
  if (game !== finished) return;
  // The results live at the challenge's own address.
  if (finished.challengeId) window.history.replaceState(null, "", `/tapmap/challenge/${finished.challengeId}`);
  text.textContent = finished.challengeSent
    ? `Sent to @${target.username}: it's waiting on their profile. Share the link with them too.`
    : target ? `Share it with @${target.username}: same five places, can they beat ${formatNumber(total)}?`
      : `Same five places for anyone you send it to. Can they beat ${formatNumber(total)}?`;
  button.textContent = "Share challenge";
  button.disabled = false;
  button.onclick = async () => {
    const message = `${target ? `@${target.username}, can` : "Can"} you beat my ${formatNumber(total)} on ${shareTitle(finished)}? Same five places: ${finished.challengeUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ text: message });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }
    toast((await copyText(message)) ? "Challenge link copied" : "Couldn't copy. Try again.");
  };
  renderChallengePlayers(finished, total);
}

// Everyone in the challenge, best first: whoever sent it, everyone who has
// played it, and you (from this device if your result isn't saved yet).
async function renderChallengePlayers(finished, total) {
  const id = finished.challengeId;
  if (!id) return;
  const resolved = finished.challenge;
  const own = !resolved || resolved.own;
  // (Sign-in may still be loading: the saved session says who you are.)
  const uid = user ? user.id : social.cachedUserId();
  const rows = [];
  if (own) {
    rows.push({ person: profile || { id: "you", username: "", display_name: "You" }, total, you: true, note: "sent it" });
  } else {
    const { ch } = resolved;
    rows.push({
      person: { id: ch.createdBy || ch.username || "sender", username: ch.username || "", display_name: challengerName(ch), avatar_url: ch.avatarUrl || null },
      total: challengerTotal(resolved), you: Boolean(uid && ch.createdBy === uid), note: "sent it", senderId: ch.createdBy,
    });
  }
  let results = [];
  try { results = await social.fetchChallengeResults(id); } catch (e) {}
  if (game !== finished) return;
  const senderId = own ? uid : resolved.ch.createdBy;
  for (const r of results) {
    if (!r.profiles || (senderId && r.user_id === senderId)) continue;
    rows.push({ person: r.profiles, total: r.total, you: Boolean(uid && r.user_id === uid) });
  }
  if (!own && !rows.some((r) => r.you)) rows.push({ person: profile || { id: "you", username: "", display_name: "You" }, total, you: true });
  rows.sort((a, b) => b.total - a.total);
  let rank = 0;
  let last = null;
  $("challenge-players-list").replaceChildren(...rows.map((r, i) => {
    if (r.total !== last) rank = i + 1;
    last = r.total;
    const li = document.createElement("li");
    if (r.you) li.className = "is-you";
    const n = document.createElement("span");
    n.className = "league-rank";
    n.textContent = String(rank);
    const who = document.createElement(r.person.username ? "a" : "span");
    who.className = "person-link";
    if (r.person.username) who.href = profileUrl(r.person.username);
    who.append(avatarElement(r.person, "sm"));
    const name = document.createElement("span");
    name.className = "friend-name";
    name.textContent = r.you ? "You" : personName(r.person);
    who.append(name);
    const note = document.createElement("span");
    note.className = "league-played";
    note.textContent = r.note || "";
    const score = document.createElement("span");
    score.className = "friend-total";
    score.textContent = formatNumber(r.total);
    li.append(n, who, note, score);
    return li;
  }));
  $("challenge-players").hidden = false;
  social.anonymousChallengePlayers(id).then((count) => {
    if (game !== finished) return;
    // (Your own result from this device, signed out, is already listed as "You".)
    const others = !user && !own ? count - 1 : count;
    $("challenge-players-anon").hidden = others < 1;
    $("challenge-players-anon").textContent = `+ ${others} more ${others === 1 ? "person" : "people"} played without an account.`;
  }).catch(() => {});
}

// Your result for a saved challenge: kept on the device, and saved to your
// account when you're signed in (now, or when you next sign in).
function recordChallengeResult(g) {
  const resolved = g.challenge;
  if (!resolved || !resolved.id || g.rounds.length < ROUNDS) return;
  const results = savedMap(CHALLENGE_RESULTS_KEY);
  if (!results[resolved.id]) {
    saveInMap(CHALLENGE_RESULTS_KEY, resolved.id, { rounds: g.rounds, total: totalScore(g.rounds), saved: false }, 200);
  }
  syncChallengeResults();
}

let syncingChallenges = false;
async function syncChallengeResults() {
  if (syncingChallenges) return;
  syncingChallenges = true;
  try {
    for (const [id, result] of Object.entries(savedMap(CHALLENGE_RESULTS_KEY))) {
      if (result.saved || !Array.isArray(result.rounds) || result.rounds.length < ROUNDS) continue;
      // Signed out, the result is counted without an account (once); it's
      // saved to the account too if they sign in later.
      if (!user && result.anonSaved) continue;
      try {
        if (!user) {
          await social.saveAnonymousChallengeResult(id, deviceId(), result.rounds, result.total);
          saveInMap(CHALLENGE_RESULTS_KEY, id, { ...result, anonSaved: true }, 200);
          continue;
        }
        await social.saveChallengeResult(id, user.id, result.rounds, result.total, deviceId());
        saveInMap(CHALLENGE_RESULTS_KEY, id, { ...result, saved: true }, 200);
      } catch (error) {
        console.warn("Challenge result not saved yet:", error);
      }
    }
  } finally {
    syncingChallenges = false;
  }
}

function renderComparison(finished) {
  const section = $("challenge-compare");
  const resolved = finished.challenge;
  // (Your own challenge: nothing to compare with, just who has played it.)
  section.hidden = !resolved || resolved.own;
  if (!resolved || resolved.own) return;
  const { ch, plan } = resolved;
  const them = challengerName(ch);
  $("compare-them").textContent = them;
  const rows = finished.rounds.map((mine, i) => {
    const theirs = ch.rounds[i];
    const tr = document.createElement("tr");
    const place = document.createElement("th");
    place.scope = "row";
    const n = document.createElement("span");
    n.className = "compare-n";
    n.textContent = ROMAN[i];
    const name = document.createElement("span");
    name.className = "compare-name";
    name.textContent = finished.locations[i].name;
    const wrap = document.createElement("span");
    wrap.className = "compare-place";
    wrap.append(n, name);
    place.append(wrap);
    const cell = (round, wins) => {
      const td = document.createElement("td");
      if (wins) td.className = "is-winner";
      td.append(tierDot(round.tier), document.createTextNode(` ${round.score}`));
      return td;
    };
    tr.append(place, cell(theirs, theirs.score > mine.score), cell(mine, mine.score > theirs.score));
    return tr;
  });
  const theirTotal = challengerTotal(resolved);
  const myTotal = totalScore(finished.rounds);
  const foot = document.createElement("tr");
  foot.className = "compare-total";
  const label = document.createElement("th");
  label.scope = "row";
  label.textContent = "Total";
  const t1 = document.createElement("td");
  t1.textContent = formatNumber(theirTotal);
  const t2 = document.createElement("td");
  t2.textContent = formatNumber(myTotal);
  if (theirTotal > myTotal) t1.className = "is-winner";
  if (myTotal > theirTotal) t2.className = "is-winner";
  foot.append(label, t1, t2);
  $("compare-rows").replaceChildren(...rows, foot);
  const diff = Math.abs(myTotal - theirTotal);
  $("compare-verdict").textContent = myTotal > theirTotal ? `You win by ${formatNumber(diff)} points.`
    : myTotal < theirTotal ? `${them} wins by ${formatNumber(diff)} points.` : "It's a draw.";
}

// Opens a saved challenge straight into play (or its comparison, if played).
async function playSavedChallenge(id) {
  try {
    const ch = challengeFromRow(await social.fetchChallenge(id));
    if (!ch) throw new Error("No such challenge");
    storage.set(CHALLENGE_KEY, { id, ch });
    const resolved = resolveChallenge(openedChallengeEntry());
    if (!resolved) throw new Error("This challenge's places aren't available");
    // Your own challenge (made on this device or signed in as its sender):
    // its results, with the rounds you played when you made it.
    resolved.own = Boolean(savedMap(CREATED_CHALLENGES_KEY)[id] || (user && ch.createdBy === user.id) || (ch.createdBy && social.cachedUserId && social.cachedUserId() === ch.createdBy));
    if (resolved.own && resolved.mode === "challenge") {
      const saved = savedMap(CHALLENGES_KEY)[resolved.code];
      if (!saved || !Array.isArray(saved.rounds) || saved.rounds.length < ROUNDS) {
        saveInMap(CHALLENGES_KEY, resolved.code, { locations: resolved.locations, rounds: roundsFromChallenge(ch, resolved.locations, resolved.plan) });
      }
    }
    // Played it signed in on another device: your saved result, not a replay.
    const uid = user ? user.id : social.cachedUserId();
    if (!resolved.own && resolved.mode === "challenge" && uid) {
      const saved = savedMap(CHALLENGES_KEY)[resolved.code];
      if (!saved || !Array.isArray(saved.rounds) || saved.rounds.length < ROUNDS) {
        const mine = (await social.fetchChallengeResults(id).catch(() => [])).find((r) => r.user_id === uid);
        if (mine && Array.isArray(mine.rounds) && mine.rounds.length === ROUNDS) {
          const theirs = { rounds: mine.rounds.map((r) => ({ score: r.score, distanceKm: r.km, tier: tierFor(r.km), guess: r.guess || null })) };
          saveInMap(CHALLENGES_KEY, resolved.code, { locations: resolved.locations, rounds: roundsFromChallenge(theirs, resolved.locations, resolved.plan) });
        }
      }
    }
    // Played at the challenge's own address.
    window.history.replaceState(null, "", `/tapmap/challenge/${id}`);
    startChallenge(resolved);
    return true;
  } catch (error) {
    console.warn(error);
    toast("That challenge couldn't be loaded.");
    return false;
  }
}

// ---------- Results ----------

let countdownTimer;

function finishGame() {
  game.phase = "done";
  clearPhoto();
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
  const notes = [round.bullseye ? "bullseye" : "", round.sat ? "from the photo" : ""].filter(Boolean);
  meta.append(tierDot(round.tier), `${formatLength(round.distanceKm)} km${notes.map((t) => ` · ${t}`).join("")}`);
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

const shareTitle = (g) => ({
  daily: `TapMap #${g.number}`,
  archive: `TapMap #${g.number} (past game)`,
  practice: "TapMap Practice",
  photo: "TapMap Photos",
  challenge: "TapMap Challenge",
}[g.mode]);

const endLabel = (g) => {
  if (g.mode === "daily") return `TapMap No. ${g.number} · ${longDateOf(today)}`;
  if (g.mode === "archive") return `TapMap No. ${g.number} · ${longDateOf(g.dateKey)} · Unranked`;
  return { practice: "Practice", photo: "Photo practice", challenge: "Challenge · Unranked" }[g.mode];
};

let shareImage = null; // { game, blob } drawn ahead so sharing is instant

async function prepareShareImage(finished) {
  const total = totalScore(finished.rounds);
  const max = maxScoreFor(finished.plan);
  const blob = await drawShareImage({
    title: shareTitle(finished),
    total,
    max,
    ratingText: ratingFor(total, max),
    rounds: finished.rounds.map((r) => ({ guess: r.guess, answer: r.answer, tier: r.tier, score: r.score })),
    colors: imageColors(),
    url: GAME_URL,
  });
  shareImage = { game: finished, blob };
  return blob;
}

async function shareImageFor(finished, text) {
  const button = $("image-button");
  button.disabled = true;
  try {
    const blob = shareImage && shareImage.game === finished ? shareImage.blob : await prepareShareImage(finished);
    const name = `${shareTitle(finished).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}.png`;
    const file = new File([blob], name, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return; // they closed the share sheet
      }
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    toast("Image saved");
  } catch (error) {
    console.error(error);
    toast("Couldn't make the image. Try again.");
  } finally {
    button.disabled = false;
  }
}

async function showEnd(finished) {
  const rounds = finished.rounds;
  const total = totalScore(rounds);
  const max = maxScoreFor(finished.plan);
  const isDaily = finished.mode === "daily";
  // Rounds saved before answers were stored get them from the places.
  rounds.forEach((r, i) => { if (!r.answer) r.answer = { lat: finished.locations[i].lat, lng: finished.locations[i].lng }; });
  if (!finished.challenge) finished.challenge = challengeFor(finished);

  $("end-label").textContent = endLabel(finished);
  $("end-rating").textContent = ratingFor(total, max);
  $("final-max").textContent = formatNumber(max);
  $("final-points").textContent = "0";
  $("breakdown").replaceChildren(...rounds.map((r, i) => breakdownRow(r, finished.locations[i], i)));
  $("unranked-note").hidden = isDaily;
  $("unranked-note").textContent = finished.mode === "practice" || finished.mode === "photo"
    ? "Practice doesn't count towards your stats or streak."
    : finished.mode === "challenge"
      ? "Challenges don't count towards your stats or streak."
      : "Unranked: saved on this device only, and it doesn't count towards your stats or streak.";

  const stats = storage.get(STATS_KEY) || {};
  $("end-stats").hidden = !isDaily;
  $("stat-played").textContent = formatNumber(stats.played || 0);
  $("stat-streak").textContent = formatNumber(currentStreak(stats, today));
  $("stat-best").textContent = formatNumber(stats.best || 0);

  const replayable = finished.mode === "practice" || finished.mode === "photo";
  $("again-button").hidden = !replayable;
  $("again-button").onclick = () => start(finished.mode);
  $("practice-button").textContent = replayable || finished.mode === "archive" ? "More practice" : "Practice";
  $("practice-button").href = finished.mode === "archive" ? "/tapmap/practice/#past" : "/tapmap/practice/";
  const dailyButton = $("daily-results-button");
  dailyButton.hidden = isDaily;
  dailyButton.textContent = dailyDone() ? "Back to today's result" : "Play today's game";

  const text = shareText({ title: shareTitle(finished), rounds, max, url: GAME_URL });
  $("copy-button").onclick = async () => {
    toast((await copyText(text)) ? "Copied" : "Couldn't copy. Try again.");
  };
  const shareButton = $("share-button");
  shareButton.hidden = !navigator.share;
  shareButton.onclick = () => navigator.share({ text }).catch(() => {});
  shareImage = null;
  $("image-button").onclick = () => shareImageFor(finished, text);
  showChallengeReady(finished, total);

  renderComparison(finished);
  if (finished.challenge) recordChallengeResult(finished);
  renderFriends(!isDaily);
  renderLeague(!isDaily);
  updateSignInPrompts();
  if (isDaily) refreshEndStats();

  startCountdown();
  openOverlay($("end"));
  animateCount($("final-points"), 0, total, 1100);
  prepareShareImage(finished).catch((error) => console.warn("Share image:", error));

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

// Played / streak / best from your account (the device's own numbers are
// shown first). Called again once sign-in finishes, since the results screen
// can open before it has, and after today's game is saved, so the streak
// includes today.
function refreshEndStats() {
  if (!user) return;
  Promise.resolve(dailySaving).catch(() => {}).then(() => social.getStats(user.id)).then((server) => {
    if (!server || !game || game.mode !== "daily" || $("end").hidden) return;
    $("stat-played").textContent = formatNumber(server.played);
    $("stat-streak").textContent = formatNumber(server.current_streak);
    $("stat-best").textContent = formatNumber(server.best);
  }).catch(() => {});
}

function startCountdown() {
  clearInterval(countdownTimer);
  const el = $("next-game");
  const tick = () => {
    if (todayKey() !== today) {
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

function start(mode, options = {}) {
  $("intro").hidden = true;
  $("end").hidden = true;
  clearInterval(countdownTimer);
  if (summary) {
    summary.destroy();
    summary = null;
  }
  game = newGame(mode, options);
  if (game.rounds.length >= ROUNDS) {
    game.phase = "done";
    prompt.hidden = true;
    actionBar.hidden = true;
    updateHeader();
    showEnd(game);
    return;
  }
  showRound();
}

// How to play. It opens by itself on a player's first visit only; after that
// it's under the ? button.
const SEEN_INTRO_KEY = "tapmap:v5:seen-intro";
const seenIntro = () => Boolean(storage.get(SEEN_INTRO_KEY))
  // Anyone who has played before has seen it.
  || Boolean(storage.get(STATS_KEY) || storage.get(DAILY_KEY));

function showIntro({ help = false } = {}) {
  storage.set(SEEN_INTRO_KEY, true);
  const partial = daily.rounds.length > 0 && !dailyDone();
  const playingDaily = Boolean(game) && game.mode === "daily" && game.phase !== "done";
  const playing = Boolean(game) && game.phase !== "done";
  $("intro-number").textContent = `No. ${todayNumber} · ${longDateOf(today)}`;
  $("play-button").textContent = dailyDone()
    ? "See today's result"
    : partial ? "Continue today's game" : "Play today's game";
  $("play-button").hidden = playingDaily;
  $("intro-close").hidden = !help;
  $("intro-close").textContent = playing ? "Back to the game" : "Close";
  updateSignInPrompts();
  openOverlay($("intro"));
}

// ---------- Wiring ----------

confirmButton.addEventListener("click", confirmGuess);
$("next-button").addEventListener("click", nextRound);
$("zoom-in").addEventListener("click", () => globe.zoomIn());
$("zoom-out").addEventListener("click", () => globe.zoomOut());
$("play-button").addEventListener("click", () => start("daily"));
$("daily-results-button").addEventListener("click", () => start("daily"));
$("photo-frame").addEventListener("click", togglePhoto);
$("photo-size").addEventListener("click", togglePhoto);
$("help-button").addEventListener("click", () => showIntro({ help: true }));
$("intro-close").addEventListener("click", () => { $("intro").hidden = true; });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!$("intro").hidden && !$("intro-close").hidden) $("intro").hidden = true;
});


// ---------- Accounts & friends ----------

let user = null;
let profile = null;
let socialError = false;
let recovering = false; // showing the "new password" form after a reset link
let friendGames = []; // today's results from people who accepted your follow
const INVITE_KEY = "tapmap:invite"; // username from an invite link, until answered
const NEXT_KEY = "tapmap:next"; // page to return to after signing in

const store = {
  get: (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch (e) {} },
  remove: (key) => { try { localStorage.removeItem(key); } catch (e) {} },
};
const profileUrl = (username) => `/tapmap/profile/${encodeURIComponent(username)}`;

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

// Shows an error directly under a form field (and clears it when they type).
function fieldError(id, text) {
  const el = $(id);
  el.textContent = text || "";
  el.hidden = !text;
  const input = el.previousElementSibling;
  if (input && input.classList.contains("field")) input.classList.toggle("is-invalid", Boolean(text));
}

function clearFieldErrors(...ids) {
  ids.forEach((id) => fieldError(id, ""));
}

const errorText = (error) => (error && error.message) || "Something went wrong. Please try again.";
const personName = (person) => (person && (person.display_name || person.username)) || "Player";

function updateAccountButton() {
  const button = $("account-button");
  button.setAttribute("aria-label", user ? `Your profile: ${personName(profile)}` : "Sign in");
  button.classList.toggle("is-signed-in", Boolean(user));
  button.querySelector(".icon-person").style.display = user ? "none" : "";
  const avatar = $("account-avatar");
  avatar.hidden = !user;
  if (user) {
    avatar.replaceChildren(avatarElement(profile || { id: user.id, username: "?" }, "sm"));
  } else {
    $("request-badge").hidden = true;
  }
}

async function refreshRequestBadge() {
  if (!user) return;
  try {
    const requests = await social.listRequests(user.id);
    const badge = $("request-badge");
    badge.textContent = String(requests.length);
    badge.hidden = requests.length === 0;
    $("account-button").setAttribute("aria-label",
      `Your profile: ${personName(profile)}${requests.length ? `, ${requests.length} follow request${requests.length > 1 ? "s" : ""}` : ""}`);
  } catch (error) {
    console.error(error);
  }
}

// Saves today's finished daily game to the account (once; the server ignores repeats).
async function syncDaily() {
  if (!user || !dailyDone()) return;
  try {
    await social.saveGame(user.id, {
      date: today, number: todayNumber, rounds: daily.rounds, total: totalScore(daily.rounds),
      names: todaysPlaces().map((l) => l.name),
      deviceId: deviceId(),
    });
  } catch (error) {
    console.error(error);
  }
}

// Today's results from people you follow, for their pins on the globe.
async function loadFriendGames() {
  if (!user) {
    friendGames = [];
    return;
  }
  try {
    const rows = await social.friendsResults(user.id, today);
    friendGames = rows.filter((row) => row.user_id !== user.id && row.profiles);
  } catch (error) {
    console.error(error);
  }
}

// Friends who played this round, shaped for the globe.
// Pins for this round: the challenger's guess (when playing a challenge), and
// in the daily game, friends who have played today.
function friendsForRound(index) {
  if (!game) return [];
  return [...challengerForRound(index), ...(game.mode === "daily" ? friendsTodayForRound(index) : [])];
}

function challengerForRound(index) {
  const resolved = game.challenge;
  const round = resolved && resolved.ch.rounds[index];
  if (!round || !round.guess) return [];
  const { ch } = resolved;
  const person = { id: ch.username || ch.by || "challenger", username: ch.username || "", display_name: challengerName(ch), avatar_url: ch.avatarUrl || null };
  // Already shown as a friend's pin (same player, daily game)?
  if (ch.username && game.mode === "daily" && friendGames.some((row) => row.profiles && row.profiles.username === ch.username)) return [];
  const pins = [{
    guess: round.guess,
    initials: initials(person),
    colour: colourFor(person),
    avatarUrl: person.avatar_url,
    name: challengerName(ch),
    details: () => challengerGuessCard(person, round),
  }];
  // Everyone else who has already played this challenge, with their photo.
  if (resolved.id && challengePlayers.id === resolved.id) {
    for (const row of challengePlayers.rows) {
      const other = row.profiles;
      const theirs = (row.rounds || [])[index];
      if (!other || !theirs || !theirs.guess || !Number.isFinite(theirs.guess.lat)) continue;
      if ((user && row.user_id === user.id) || row.user_id === ch.createdBy) continue;
      if (game.mode === "daily" && friendGames.some((f) => f.user_id === row.user_id)) continue;
      pins.push({
        guess: theirs.guess,
        initials: initials(other),
        colour: colourFor(other),
        avatarUrl: other.avatar_url || null,
        name: personName(other),
        details: () => friendGuessCard(other, theirs),
      });
    }
  }
  return pins;
}

// The card shown when the challenger's pin is tapped.
function challengerGuessCard(person, round) {
  const card = document.createElement("div");
  card.className = "friend-card";
  const head = document.createElement(person.username ? "a" : "div");
  head.className = "person-link";
  if (person.username) head.href = profileUrl(person.username);
  head.append(avatarElement(person, "sm"));
  const text = document.createElement("span");
  text.className = "person-text";
  const name = document.createElement("span");
  name.className = "person-name";
  name.textContent = person.display_name;
  const handle = document.createElement("span");
  handle.className = "person-handle";
  handle.textContent = person.username ? `@${person.username} · challenger` : "Challenger";
  text.append(name, handle);
  head.append(text);
  const stats = document.createElement("p");
  stats.className = "friend-card-stats";
  const score = document.createElement("strong");
  score.textContent = String(round.score);
  const of = document.createElement("span");
  of.className = "of";
  of.textContent = "/100";
  stats.append(score, of);
  const meta = document.createElement("p");
  meta.className = "friend-card-meta";
  if (TIERS[round.tier]) meta.append(tierDot(round.tier));
  meta.append(` ${formatLength(round.distanceKm)} km away`);
  card.append(head, stats, meta);
  return card;
}

function friendsTodayForRound(index) {
  return friendGames
    .map((row) => ({ row, round: (row.rounds || [])[index] }))
    .filter(({ round }) => round && round.guess && Number.isFinite(round.guess.lat) && Number.isFinite(round.guess.lng))
    .map(({ row, round }) => ({
      guess: round.guess,
      initials: initials(row.profiles),
      colour: colourFor(row.profiles),
      avatarUrl: row.profiles.avatar_url || null,
      name: personName(row.profiles),
      details: () => friendGuessCard(row.profiles, round),
    }));
}

// The card shown when a friend's pin is tapped: who, how close, and a link.
function friendGuessCard(person, round) {
  const card = document.createElement("div");
  card.className = "friend-card";
  const head = document.createElement("a");
  head.className = "person-link";
  head.href = profileUrl(person.username);
  head.append(avatarElement(person, "sm"));
  const text = document.createElement("span");
  text.className = "person-text";
  const name = document.createElement("span");
  name.className = "person-name";
  name.textContent = personName(person);
  const handle = document.createElement("span");
  handle.className = "person-handle";
  handle.textContent = `@${person.username}`;
  text.append(name, handle);
  head.append(text);
  const stats = document.createElement("p");
  stats.className = "friend-card-stats";
  const score = document.createElement("strong");
  score.textContent = String(round.score ?? "–");
  const of = document.createElement("span");
  of.className = "of";
  of.textContent = "/100";
  stats.append(score, of);
  const meta = document.createElement("p");
  meta.className = "friend-card-meta";
  const tier = Number.isFinite(round.km) ? tierFor(round.km) : round.tier;
  if (TIERS[tier]) meta.append(tierDot(tier));
  const km = Number.isFinite(round.km) ? `${formatLength(round.km)} km away` : "";
  const where = `${Math.abs(round.guess.lat).toFixed(1)}°${round.guess.lat >= 0 ? "N" : "S"}, ${Math.abs(round.guess.lng).toFixed(1)}°${round.guess.lng >= 0 ? "E" : "W"}`;
  meta.append(` ${[km, where].filter(Boolean).join(" · ")}`);
  card.append(head, stats, meta);
  return card;
}

// ---------- Sign-in sheet ----------

function renderAccount() {
  if (recovering) return;
  $("account-signed-out").hidden = Boolean(user);
  const invite = store.get(INVITE_KEY);
  $("invite-note").hidden = !invite || Boolean(user);
  $("invite-note").textContent = invite ? `@${invite} invited you. Create an account (or sign in) and you can follow them straight away.` : "";
}

function openAccount() {
  if (user && profile) {
    window.location.href = profileUrl(profile.username);
    return;
  }
  accountMessage(socialError ? "Sign-in couldn't load. Check your connection and refresh the page." : "", socialError);
  clearFieldErrors("username-error", "password-error");
  document.querySelectorAll("#provider-buttons button, #email-form button").forEach((b) => { b.disabled = socialError; });
  renderAccount();
  openOverlay($("account"));
}

// ---------- Invites ----------

// Called once signed in: offer to follow whoever shared the invite link.
async function offerInvite() {
  const username = store.get(INVITE_KEY);
  if (!username || !user) return false;
  let inviter = null;
  try {
    inviter = await social.getProfileByUsername(username);
  } catch (error) {
    console.error(error);
  }
  if (!inviter || inviter.id === user.id) {
    store.remove(INVITE_KEY);
    return false;
  }
  const state = await social.followStatus(user.id, inviter.id).catch(() => null);
  if (state) {
    store.remove(INVITE_KEY);
    return false;
  }
  $("account").hidden = true;
  $("invite-avatar").replaceChildren(avatarElement(inviter, "lg"));
  $("invite-title").textContent = personName(inviter);
  $("invite-handle").textContent = `@${inviter.username}`;
  $("invite-text").textContent = `${personName(inviter)} invited you to TapMap. Send them a follow request? Once they accept, you'll see each other's scores.`;
  $("invite-message").textContent = "";
  $("invite-follow").onclick = async () => {
    $("invite-follow").disabled = true;
    try {
      await social.requestFollow(user.id, inviter.id);
      store.remove(INVITE_KEY);
      $("invite-prompt").hidden = true;
      toast(`Follow request sent to @${inviter.username}`);
      afterInvite();
    } catch (error) {
      $("invite-message").textContent = errorText(error);
    } finally {
      $("invite-follow").disabled = false;
    }
  };
  $("invite-skip").onclick = () => {
    store.remove(INVITE_KEY);
    $("invite-prompt").hidden = true;
    afterInvite();
  };
  openOverlay($("invite-prompt"));
  return true;
}

// After signing in (and any invite), return to the page that asked for it.
function afterInvite() {
  const next = store.get(NEXT_KEY);
  if (next && user) {
    store.remove(NEXT_KEY);
    // Back to the profile, challenge or practice page that asked to sign in.
    if (/^\/tapmap\/(profile|challenge|practice)\//.test(next)) window.location.href = next;
  }
}

// ---------- Results screen: friends today ----------

async function renderFriends(notDaily) {
  const section = $("friends");
  section.hidden = notDaily || !social.socialEnabled();
  if (section.hidden) return;
  $("friends-signin").hidden = Boolean(user);
  $("friends-list").replaceChildren();
  $("friends-empty").hidden = true;
  if (!user) return;
  try {
    const rows = await social.friendsResults(user.id, today);
    const others = rows.filter((r) => r.user_id !== user.id);
    $("friends-list").replaceChildren(...rows.map((row) => {
      const you = row.user_id === user.id;
      const person = you ? profile || row.profiles : row.profiles;
      const li = document.createElement("li");
      if (you) li.className = "is-you";
      const who = document.createElement("a");
      who.className = "person-link";
      if (person && person.username) who.href = profileUrl(person.username);
      who.append(avatarElement(person, "sm"));
      const name = document.createElement("span");
      name.className = "friend-name";
      name.textContent = you ? "You" : personName(person);
      who.append(name);
      const tiers = document.createElement("span");
      tiers.className = "friend-tiers";
      tiers.setAttribute("aria-hidden", "true");
      for (const r of row.rounds || []) {
        const tier = Number.isFinite(r.km) ? tierFor(r.km) : r.tier;
        if (TIERS[tier]) tiers.append(tierDot(tier));
      }
      const total = document.createElement("span");
      total.className = "friend-total";
      total.textContent = formatNumber(row.total);
      li.append(who, tiers, total);
      return li;
    }));
    $("friends-empty").hidden = others.length > 0;
  } catch (error) {
    console.error(error);
  }
}

// ---------- Results screen: this week's league ----------

// Monday to Sunday, you and the players who accepted your follow, by points.
async function renderLeague(notDaily) {
  const section = $("league");
  section.hidden = true;
  if (notDaily || !user || !social.socialEnabled()) return;
  const monday = weekStart(today);
  const sunday = new Date(Date.parse(monday) + 6 * 86400000).toISOString().slice(0, 10);
  $("league-dates").textContent = `${shortDateOf(monday)} – ${shortDateOf(sunday)}`;
  try {
    const rows = await social.weeklyLeague(monday);
    if (!rows.length) return;
    $("league-list").replaceChildren(...rows.map((row) => {
      const you = row.user_id === user.id;
      const person = you && profile ? profile : { id: row.user_id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url };
      const li = document.createElement("li");
      if (you) li.className = "is-you";
      const rank = document.createElement("span");
      rank.className = "league-rank";
      rank.textContent = String(row.rank);
      const who = document.createElement("a");
      who.className = "person-link";
      who.href = profileUrl(person.username);
      who.append(avatarElement(person, "sm"));
      const name = document.createElement("span");
      name.className = "friend-name";
      name.textContent = you ? "You" : personName(person);
      who.append(name);
      const played = document.createElement("span");
      played.className = "league-played";
      played.textContent = `${row.played} ${row.played === 1 ? "day" : "days"}`;
      const points = document.createElement("span");
      points.className = "friend-total";
      points.textContent = formatNumber(row.points);
      li.append(rank, who, played, points);
      return li;
    }));
    $("league-empty").hidden = rows.some((r) => r.user_id !== user.id);
    section.hidden = false;
  } catch (error) {
    // (Hidden until setup.sql has been re-run to create weekly_league.)
    console.warn("Weekly league:", error);
  }
}

// Saves the player's time zone to their profile (when it changes), so the
// streak on their profile uses their own date, like the game does.
function saveTimeZone() {
  let zone = null;
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
  if (!user || !zone) return;
  const key = `tapmap:v5:tz:${user.id}`;
  if (store.get(key) === zone) return;
  social.saveTimeZone(user.id, zone).then(() => store.set(key, zone)).catch((error) => console.warn("Time zone:", error));
}

// Signed-out players get a clear way to sign in on the intro and results screens.
function updateSignInPrompts() {
  const show = social.socialEnabled() && !user;
  $("intro-signin").hidden = !show;
  $("end-signin").hidden = !show;
}

async function onSignedIn(nextUser) {
  user = nextUser;
  profile = null;
  friendGames = [];
  if (user) {
    try {
      profile = await social.getProfile(user.id);
    } catch (error) {
      console.error(error);
    }
    // A saved sign-in whose account is gone (e.g. deleted) is cleared, so the
    // player sees the sign-up form rather than a broken "signed in" state.
    if (!profile) {
      const still = await social.verifiedUser().catch(() => null);
      if (!still || !(profile = await social.getProfile(user.id).catch(() => null))) {
        if (still) await social.signOut();
        user = null;
        profile = null;
      }
    }
  }
  if (user) {
    await syncDaily();
    loadFriendGames();
    refreshRequestBadge();
    saveTimeZone();
    // (Finished before any return to the page that asked for sign-in.)
    await syncChallengeResults();
  } else {
    // Signed out: count today's game and any challenge results without an account.
    saveAnonymousDaily();
    syncChallengeResults();
  }
  updateAccountButton();
  updateSignInPrompts();
  if (user) $("account").hidden = true;
  else if (!$("account").hidden) renderAccount();
  if (!$("end").hidden && game) {
    renderFriends(game.mode !== "daily");
    renderLeague(game.mode !== "daily");
    if (game.mode === "daily") refreshEndStats();
    // A challenge's results: now we know who you are (and your photo).
    if (game.challengeId) renderChallengePlayers(game, totalScore(game.rounds));
  }
  if (user && !(await offerInvite())) afterInvite();
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
    // An invite link or "?signin=1" opens the sign-in sheet for signed-out players.
    if (!user && (pendingSignIn || store.get(INVITE_KEY))) openAccount();
  } catch (error) {
    // Keep the button so the problem is visible rather than silently missing.
    console.error(error);
    socialError = true;
  }
}

$("account-button").addEventListener("click", openAccount);
$("intro-signin-button").addEventListener("click", openAccount);
$("end-signin-button").addEventListener("click", openAccount);

// Keep the follow-request badge current: when the tab comes back, and every 2 minutes.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshRequestBadge();
});
setInterval(() => { if (document.visibilityState === "visible") refreshRequestBadge(); }, 120000);
$("friends-signin").addEventListener("click", openAccount);
$("account-close").addEventListener("click", () => { $("account").hidden = true; });

// ---------- Username & password ----------

// Where each sign-in error belongs: under the username or the password field.
const AUTH_ERRORS = {
  invalid_credentials: ["password-error", "That username and password don't match. Try again, or create an account."],
  user_already_exists: ["username-error", "That username is taken. Try another."],
  email_not_confirmed: ["username-error", "This account is waiting for email confirmation."],
  weak_password: ["password-error", "Choose a longer password (at least 8 characters)."],
  over_email_send_rate_limit: ["password-error", "Too many attempts. Please try again later."],
  over_request_rate_limit: ["password-error", "Too many attempts. Please try again later."],
};

function showAuthError(error) {
  const [field, text] = AUTH_ERRORS[error && error.code] || ["password-error", errorText(error)];
  fieldError(field, text);
}

function readCredentials({ forSignUp = false } = {}) {
  clearFieldErrors("username-error", "password-error");
  accountMessage("");
  const identifier = $("email-input").value.trim();
  const password = $("password-input").value;
  const isEmail = identifier.includes("@");
  let ok = true;
  if (!identifier) {
    fieldError("username-error", "Enter a username.");
    ok = false;
  } else if (forSignUp ? !social.USERNAME_PATTERN.test(identifier.toLowerCase()) : !(isEmail || social.USERNAME_PATTERN.test(identifier.toLowerCase()))) {
    fieldError("username-error", "Usernames are 3–20 lowercase letters, numbers or _.");
    ok = false;
  }
  if (password.length < 8) {
    fieldError("password-error", password ? "Passwords are at least 8 characters." : "Enter a password.");
    ok = false;
  }
  return ok ? { identifier, password } : null;
}

async function withBusy(button, work, onError = showAuthError) {
  button.disabled = true;
  const label = button.textContent;
  try {
    await work();
  } catch (error) {
    onError(error);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

$("email-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const creds = readCredentials();
  if (!creds) return;
  const button = $("password-sign-in");
  withBusy(button, async () => {
    button.textContent = "Signing in…";
    await social.signInWithPassword(creds.identifier, creds.password);
    $("password-input").value = "";
  });
});

$("password-sign-up").addEventListener("click", () => {
  const creds = readCredentials({ forSignUp: true });
  if (!creds) return;
  const button = $("password-sign-up");
  withBusy(button, async () => {
    button.textContent = "Creating account…";
    if (await social.usernameTaken(creds.identifier)) {
      fieldError("username-error", "That username is taken. Try another.");
      return;
    }
    const signedIn = await social.signUpWithUsername(creds.identifier, creds.password);
    $("password-input").value = "";
    if (!signedIn) fieldError("username-error", "Account created, but it's waiting for email confirmation. Turn off \"Confirm email\" in Supabase.");
  });
});

["email-input", "password-input"].forEach((id) => {
  $(id).addEventListener("input", () => fieldError(id === "email-input" ? "username-error" : "password-error", ""));
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
    fieldError("new-password-error", "Passwords are at least 8 characters.");
    return;
  }
  fieldError("new-password-error", "");
  withBusy($("recovery-form").querySelector("button"), async () => {
    await social.updatePassword(password);
    $("new-password").value = "";
    $("recovery-form").hidden = true;
    recovering = false;
    await renderAccount();
    accountMessage("Password updated. You're signed in.");
  }, (error) => fieldError("new-password-error", errorText(error)));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("account").hidden) $("account").hidden = true;
});

// Read ?invite=, ?signin= and ?challenge= once, then tidy the address bar.
const params = new URLSearchParams(window.location.search);
const pendingSignIn = params.has("signin");
// Links from the practice page: ?play=practice, ?play=photo, ?play=archive&n=3.
// (?play=satellite is the old name for photo practice.)
const playParam = params.get("play") === "satellite" ? "photo" : params.get("play");
// ?send=1 (and ?to=username): this practice game is a challenge to send.
if (params.has("send") || /^[a-z0-9_]{3,20}$/.test(params.get("to") || "")) {
  challengeIntent = { target: /^[a-z0-9_]{3,20}$/.test(params.get("to") || "") ? { username: params.get("to") } : null };
}
const playNumber = Number(params.get("n"));
// ?c={id}: the Play button on a /tapmap/challenge/{id} page.
const challengeId = /^[a-z0-9]{6,16}$/.test(params.get("c") || "") ? params.get("c") : null;
const openedChallenge = Boolean(params.get("challenge") && decodeChallenge(params.get("challenge")));
if (openedChallenge) storage.set(CHALLENGE_KEY, params.get("challenge"));
else if (params.has("challenge")) window.addEventListener("load", () => toast("That challenge link isn't complete. Ask for it again."));
if (params.get("invite") && /^[a-z0-9_]{3,20}$/i.test(params.get("invite"))) {
  store.set(INVITE_KEY, params.get("invite").toLowerCase());
}
if (["invite", "signin", "challenge", "c", "play", "n", "to", "send"].some((key) => params.has(key))) {
  window.history.replaceState(null, "", window.location.pathname);
}
// The profile button is always there (it opens sign-in until you're signed in).
if (social.socialEnabled()) $("account-button").hidden = false;

// ---------- Boot ----------

async function boot() {
  const poolReady = Promise.all([loadPool(), loadPhotoPlaces()]);
  globe = await createGlobe($("globe"), { onTap: onGlobeTap, reducedMotion, colors: globeColors() });
  await poolReady;
  window.tapmapReady = true;
  updateHeader();
  bootSocial();
  if (challengeId && (await playSavedChallenge(challengeId))) return;
  if (openedChallenge && offerChallenge()) return;
  if (playParam === "practice" || playParam === "photo") return start(playParam, { sendAsChallenge: challengeIntent });
  if (playParam === "archive" && Number.isInteger(playNumber) && playNumber >= 1 && playNumber < todayNumber) {
    return start("archive", { number: playNumber });
  }
  // First visit: how to play. After that, straight into today's game (or its result).
  if (!seenIntro()) showIntro();
  else start("daily");
}

boot().catch((error) => {
  console.error(error);
  $("load-error").hidden = false;
});
