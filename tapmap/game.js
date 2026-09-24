// Pure game logic for TapMap: no DOM, so it can be tested on its own.

export const LAUNCH_DATE = "2026-09-24";

// Rounds get harder, and are worth more, as the game goes on.
export const ROUND_PLAN = [
  { difficulty: "easy", multiplier: 1 },
  { difficulty: "medium", multiplier: 1.25 },
  { difficulty: "medium", multiplier: 1.5 },
  { difficulty: "hard", multiplier: 1.75 },
  { difficulty: "hard", multiplier: 2 },
];
export const ROUNDS = ROUND_PLAN.length;
export const MAX_ROUND_SCORE = 1000;
export const MAX_SCORE = ROUND_PLAN.reduce((sum, r) => sum + MAX_ROUND_SCORE * r.multiplier, 0);
export const BULLSEYE_KM = 25;
export const BULLSEYE_BONUS = 50;
export const GAME_URL = "https://gabarker.com/tapmap";

const DAY_MS = 86400000;
const EARTH_RADIUS_KM = 6371;
const KM_PER_MILE = 1.609344;

// ---------- Dates ----------

// "YYYY-MM-DD" for the current UTC day.
export const utcDateKey = (date = new Date()) => date.toISOString().slice(0, 10);

// Game #1 is the launch day.
export const gameNumber = (dateKey) =>
  Math.round((Date.parse(dateKey) - Date.parse(LAUNCH_DATE)) / DAY_MS) + 1;

export const previousDateKey = (dateKey) =>
  utcDateKey(new Date(Date.parse(dateKey) - DAY_MS));

// Milliseconds until the next UTC midnight.
export const msUntilNextGame = (now = new Date()) => {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
};

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

// Five locations following ROUND_PLAN (easy → hard), drawn with `rng`.
const planLocations = (pool, rng) => {
  const picks = {};
  for (const level of new Set(ROUND_PLAN.map((r) => r.difficulty))) {
    const count = ROUND_PLAN.filter((r) => r.difficulty === level).length;
    picks[level] = sample(pool.filter((loc) => loc.difficulty === level), count, rng);
  }
  return ROUND_PLAN.map((r) => picks[r.difficulty].shift());
};

// Same five for everyone on a given UTC date.
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

// round(1000 × e^(−d/2000)), plus a bullseye bonus under 25 km, capped at 1,000,
// then scaled by the round's multiplier.
export const scoreRound = (distanceKm, multiplier = 1) => {
  const base = Math.round(MAX_ROUND_SCORE * Math.exp(-distanceKm / 2000));
  const bullseye = distanceKm < BULLSEYE_KM;
  const points = bullseye ? Math.min(MAX_ROUND_SCORE, base + BULLSEYE_BONUS) : base;
  return { base, bonus: points - base, bullseye, points, multiplier, total: Math.round(points * multiplier) };
};

export const tierFor = (distanceKm) => {
  if (distanceKm < 50) return "🎯";
  if (distanceKm < 500) return "🟩";
  if (distanceKm < 1500) return "🟨";
  if (distanceKm < 3000) return "🟧";
  return "🟥";
};

// Thresholds are 90%, 70% and 40% of the maximum (4,500 / 3,500 / 2,000 out of 5,000).
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

export const totalScore = (rounds) => rounds.reduce((sum, r) => sum + r.total, 0);

// ---------- Formatting ----------

export const formatNumber = (n) => Math.round(n).toLocaleString("en-US");

const formatLength = (value) =>
  value < 10 ? value.toFixed(1) : formatNumber(value);

// "1,234 km (767 mi)"
export const formatDistance = (km) => `${formatLength(km)} km (${formatLength(km / KM_PER_MILE)} mi)`;

// Figure spaces are digit-width in most fonts, so columns roughly line up in chat apps.
const FIGURE_SPACE = "\u2007";
const COLUMN = 4;

// Spoiler-free share text: no location names, five short lines.
//   TapMap #1
//   1000 1093  712 1729  352
//     🎯   🟩   🟨   🟩   🟥
//   3,969 / 7,500 · Tourist
//   https://gabarker.com/tapmap
export const shareText = ({ number, practice, rounds, url = GAME_URL }) => {
  const total = totalScore(rounds);
  const scores = rounds.map((r) => String(r.total).padStart(COLUMN, FIGURE_SPACE)).join(" ");
  // An emoji is about two digits wide, so indent each one under the last two digits.
  const tiers = rounds.map((r) => FIGURE_SPACE.repeat(COLUMN - 2) + r.tier).join(" ");
  return [
    practice ? "TapMap Practice" : `TapMap #${number}`,
    scores,
    tiers,
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
