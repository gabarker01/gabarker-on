// Pure game logic for TapMap: no DOM, so it can be tested on its own.

export const LAUNCH_DATE = "2026-09-24";

// Rounds get harder, and weigh more, as the game goes on. Each round is scored
// out of 100; the weights add up to 10, so a perfect game totals 1,000.
export const ROUND_PLAN = [
  { difficulty: "easy", multiplier: 1 },
  { difficulty: "medium", multiplier: 1.5 },
  { difficulty: "medium", multiplier: 2 },
  { difficulty: "hard", multiplier: 2.5 },
  { difficulty: "hard", multiplier: 3 },
];
export const ROUNDS = ROUND_PLAN.length;
export const ROUND_MAX = 100;
export const MAX_SCORE = ROUND_PLAN.reduce((sum, r) => sum + ROUND_MAX * r.multiplier, 0);
export const BULLSEYE_KM = 25;
export const BULLSEYE_BONUS = 5;
export const GAME_URL = "https://gabarker.com/tapmap";

const DAY_MS = 86400000;
const EARTH_RADIUS_KM = 6371;
const KM_PER_MILE = 1.609344;

// ---------- Dates ----------

const pad = (n) => String(n).padStart(2, "0");

// "YYYY-MM-DD" for the player's own calendar day (their device's time zone),
// so a new game starts at their local midnight. Everyone on the same date
// gets the same five places.
export const todayKey = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// Game #1 is the launch day. (Keys are compared as calendar dates.)
export const gameNumber = (dateKey) =>
  Math.round((Date.parse(dateKey) - Date.parse(LAUNCH_DATE)) / DAY_MS) + 1;

export const previousDateKey = (dateKey) =>
  new Date(Date.parse(dateKey) - DAY_MS).toISOString().slice(0, 10);

// Milliseconds until the player's next local midnight.
export const msUntilNextGame = (now = new Date()) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;

// ---------- Seeded randomness ----------

// xmur3 string hash -> 32-bit seed.
const hashString = (str) => {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
};

// mulberry32 PRNG: returns a function giving floats in [0, 1).
export const seededRandom = (seedString) => {
  let a = hashString(seedString);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Pick `count` distinct items from `items` using `rng`.
const sample = (items, count, rng) => {
  const pool = items.slice();
  const picked = [];
  for (let i = 0; i < count && pool.length; i++) {
    const index = Math.floor(rng() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
};

// The pool for a given day: places added before that date and not yet
// retired. Adding a place mid-day therefore never changes a game in progress.
export const poolFor = (dateKey, locations) =>
  locations.filter((loc) =>
    (!loc.added_on || loc.added_on < dateKey) && (!loc.retired_on || loc.retired_on > dateKey));

// Five locations following ROUND_PLAN (easy → hard), drawn with `rng`.
const planLocations = (pool, rng) => {
  const picks = {};
  for (const level of new Set(ROUND_PLAN.map((r) => r.difficulty))) {
    const count = ROUND_PLAN.filter((r) => r.difficulty === level).length;
    picks[level] = sample(pool.filter((loc) => loc.difficulty === level), count, rng);
  }
  return ROUND_PLAN.map((r) => picks[r.difficulty].shift());
};

// Same five for everyone on a given (local) date.
export const dailyLocations = (dateKey, pool) => planLocations(pool, seededRandom(`tapmap:${dateKey}`));

export const practiceLocations = (pool, rng = Math.random) => planLocations(pool, rng);

// ---------- Distance & scoring ----------

const toRad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance in km between two { lat, lng } points.
export const haversineKm = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

// Round score out of 100: round(100 × e^(−d/2000)), plus a 5-point bullseye
// bonus under 25 km, capped at 100. It counts towards the game total × the
// round's multiplier.
export const scoreRound = (distanceKm, multiplier = 1) => {
  const base = Math.round(ROUND_MAX * Math.exp(-distanceKm / 2000));
  const bullseye = distanceKm < BULLSEYE_KM;
  const score = bullseye ? Math.min(ROUND_MAX, base + BULLSEYE_BONUS) : base;
  return { base, bonus: score - base, bullseye, score, multiplier, weighted: score * multiplier };
};

export const tierFor = (distanceKm) => {
  if (distanceKm < 50) return "🎯";
  if (distanceKm < 500) return "🟩";
  if (distanceKm < 1500) return "🟨";
  if (distanceKm < 3000) return "🟧";
  return "🟥";
};

// Thresholds are 90%, 70% and 40% of the maximum (900 / 700 / 400 out of 1,000).
const RATINGS = [
  { min: 0.9, label: "Cartographer", emoji: "🧭" },
  { min: 0.7, label: "Navigator", emoji: "" },
  { min: 0.4, label: "Tourist", emoji: "" },
  { min: 0, label: "Lost", emoji: "🫠" },
];
export const rating = (total) => RATINGS.find((r) => total >= r.min * MAX_SCORE);
export const ratingFor = (total) => {
  const r = rating(total);
  return r.emoji ? `${r.label} ${r.emoji}` : r.label;
};

// Everything recorded about a finished round.
export const evaluateGuess = (guess, location, multiplier = 1) => {
  const distanceKm = haversineKm(guess, location);
  return { guess, distanceKm, ...scoreRound(distanceKm, multiplier), tier: tierFor(distanceKm) };
};

export const totalScore = (rounds) => Math.round(rounds.reduce((sum, r) => sum + r.weighted, 0));

// ---------- Formatting ----------

export const formatNumber = (n) => Math.round(n).toLocaleString("en-US");

const formatLength = (value) =>
  value < 10 ? value.toFixed(1) : formatNumber(value);

// "1,234 km (767 mi)"
export const formatDistance = (km) => `${formatLength(km)} km (${formatLength(km / KM_PER_MILE)} mi)`;

// Spoiler-free share text: no location names, four short lines.
//   TapMap #1
//   🎯 100 🟩 91 🟨 58 🟩 83 🟥 12
//   596 / 1,000 · Tourist
//   https://gabarker.com/tapmap
export const shareText = ({ number, practice, rounds, url = GAME_URL }) => {
  const total = totalScore(rounds);
  return [
    practice ? "TapMap Practice" : `TapMap #${number}`,
    rounds.map((r) => `${r.tier} ${r.score}`).join(" "),
    `${formatNumber(total)} / ${formatNumber(MAX_SCORE)} · ${ratingFor(total)}`,
    url,
  ].join("\n");
};

// ---------- Stats ----------

// Returns updated stats after finishing the daily game for `dateKey`.
export const recordDailyResult = (stats, dateKey, total) => {
  const s = { played: 0, streak: 0, maxStreak: 0, best: 0, lastDate: null, ...stats };
  if (s.lastDate === dateKey) return s;
  s.streak = s.lastDate === previousDateKey(dateKey) ? s.streak + 1 : 1;
  s.maxStreak = Math.max(s.maxStreak, s.streak);
  s.best = Math.max(s.best, total);
  s.played += 1;
  s.lastDate = dateKey;
  return s;
};

// A streak only counts if the last daily was today or yesterday.
export const currentStreak = (stats, todayKey) =>
  stats && (stats.lastDate === todayKey || stats.lastDate === previousDateKey(todayKey))
    ? stats.streak
    : 0;
