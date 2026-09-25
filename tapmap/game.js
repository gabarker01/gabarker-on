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
export const BULLSEYE_KM = 25; // the 🎯 band and the bonus both use this
export const BULLSEYE_BONUS = 5;

// Satellite practice: the same easy-to-hard rounds as the daily game, but
// each place is shown only as a satellite photo (the name appears once you've
// guessed). Scored exactly like the daily game, out of 1,000.
export const SATELLITE_PLAN = ROUND_PLAN.map((r) => ({ ...r, satellite: true }));

export const maxScoreFor = (plan = ROUND_PLAN) => plan.reduce((sum, r) => sum + ROUND_MAX * r.multiplier, 0);
export const MAX_SCORE = maxScoreFor(ROUND_PLAN); // 1,000 (satellite practice too)
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

const LEVELS = [...new Set(ROUND_PLAN.map((r) => r.difficulty))];
const PER_DAY = Object.fromEntries(LEVELS.map((level) => [level, ROUND_PLAN.filter((r) => r.difficulty === level).length]));

// Five locations following a plan (ROUND_PLAN: easy → hard), drawn with `rng`.
const planLocations = (pool, rng, plan = ROUND_PLAN) => {
  const picks = {};
  for (const level of new Set(plan.map((r) => r.difficulty))) {
    const count = plan.filter((r) => r.difficulty === level).length;
    picks[level] = sample(pool.filter((loc) => loc.difficulty === level), count, rng);
  }
  return plan.map((r) => picks[r.difficulty].shift());
};

export const nextDateKey = (dateKey) =>
  new Date(Date.parse(dateKey) + DAY_MS).toISOString().slice(0, 10);

// The date of TapMap No. `number`.
export const dateForNumber = (number) =>
  new Date(Date.parse(LAUNCH_DATE) + (number - 1) * DAY_MS).toISOString().slice(0, 10);

// Games before this date keep the original picker (a fresh random draw each
// day, which often repeated last week's places). From this date, each
// difficulty works through its whole list before any place comes round again.
export const PICKER_START = "2026-09-27";

// The original picker, unchanged, for games before PICKER_START.
const originalPicks = (dateKey, locations) =>
  planLocations(poolFor(dateKey, locations), seededRandom(`tapmap:${dateKey}`));

// The picker from PICKER_START is a replay of every day since launch, so it
// needs no stored state and gives everyone the same places:
//  - Each difficulty goes through "cycles". In a cycle every live place is
//    shown once, in an order shuffled by hashing its name with the cycle
//    number. Once all of them have been shown, the next cycle starts.
//  - Places are matched by name, never by position in the list, so the order
//    of the list doesn't matter. A place added (or retired) on a date only
//    changes games from that date on; earlier games stay exactly as they were.
//  - A place shown recently waits its turn: in a new cycle, a place is only
//    picked once it has rested for all but the last 3 days of a cycle (so with
//    20 hard places, 2 a day, a hard place comes back after 8 days at the
//    soonest). The end of one cycle never runs straight into the next.
const rankIn = (level, cycle, name) => hashString(`tapmap:cycle:${level}:${cycle}:${name}`);

const simulations = new WeakMap(); // locations array -> { upTo, days: Map(dateKey -> picks) }

function simulate(locations, upTo) {
  const cached = simulations.get(locations);
  if (cached && cached.upTo >= upTo) return cached.days;
  const days = new Map();
  const state = Object.fromEntries(LEVELS.map((level) => [level, { cycle: 0, used: new Set(), lastSeen: new Map() }]));
  let day = 0;
  for (let key = LAUNCH_DATE; key <= upTo; key = nextDateKey(key), day++) {
    if (key < PICKER_START) {
      // Days from the original picker count towards the first cycle.
      const picks = originalPicks(key, locations);
      picks.forEach((loc) => {
        if (!loc) return;
        state[loc.difficulty].used.add(loc.name);
        state[loc.difficulty].lastSeen.set(loc.name, day);
      });
      days.set(key, picks);
      continue;
    }
    const pool = poolFor(key, locations);
    const picks = {};
    for (const level of LEVELS) {
      const s = state[level];
      const live = pool.filter((loc) => loc.difficulty === level);
      const cooldown = Math.max(0, Math.floor(live.length / PER_DAY[level]) - 3);
      const chosen = [];
      while (chosen.length < PER_DAY[level]) {
        const open = live.filter((loc) => !chosen.includes(loc));
        if (!open.length) break; // not enough places at this level
        let candidates = open.filter((loc) => !s.used.has(loc.name));
        if (!candidates.length) {
          // Every live place has been shown this cycle: start the next one.
          s.cycle += 1;
          s.used = new Set();
          candidates = open;
        }
        candidates.sort((a, b) => rankIn(level, s.cycle, a.name) - rankIn(level, s.cycle, b.name) || (a.name < b.name ? -1 : 1));
        const rested = candidates.find((loc) => !s.lastSeen.has(loc.name) || day - s.lastSeen.get(loc.name) > cooldown);
        // (If nothing has rested long enough, the one shown longest ago.)
        const pick = rested || candidates.reduce((a, b) => (s.lastSeen.get(b.name) < s.lastSeen.get(a.name) ? b : a));
        chosen.push(pick);
        s.used.add(pick.name);
        s.lastSeen.set(pick.name, day);
      }
      picks[level] = chosen;
    }
    days.set(key, ROUND_PLAN.map((r) => picks[r.difficulty].shift()));
  }
  simulations.set(locations, { upTo, days });
  return days;
}

// Same five for everyone on a given (local) date. `locations` is the whole
// list, including places added later or already retired (each has its dates).
export const dailyLocations = (dateKey, locations) =>
  dateKey < PICKER_START || dateKey < LAUNCH_DATE
    ? originalPicks(dateKey, locations)
    : simulate(locations, dateKey).get(dateKey);

export const practiceLocations = (pool, rng = Math.random, plan = ROUND_PLAN) => planLocations(pool, rng, plan);

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
// round's multiplier. (`satellite` only marks a round played from the photo.)
export const scoreRound = (distanceKm, multiplier = 1, { satellite = false } = {}) => {
  const base = Math.round(ROUND_MAX * Math.exp(-distanceKm / 2000));
  const bullseye = distanceKm < BULLSEYE_KM;
  const score = bullseye ? Math.min(ROUND_MAX, base + BULLSEYE_BONUS) : base;
  return { base, bonus: score - base, bullseye, sat: satellite, score, multiplier, weighted: score * multiplier };
};

export const tierFor = (distanceKm) => {
  if (distanceKm < BULLSEYE_KM) return "🎯";
  if (distanceKm < 500) return "🟩";
  if (distanceKm < 1500) return "🟨";
  if (distanceKm < 3000) return "🟧";
  return "🟥";
};

// Thresholds are 90%, 70% and 40% of the game's maximum (900 / 700 / 400 out
// of 1,000).
const RATINGS = [
  { min: 0.9, label: "Cartographer", emoji: "🧭" },
  { min: 0.7, label: "Navigator", emoji: "⛵" },
  { min: 0.4, label: "Tourist", emoji: "📸" },
  { min: 0, label: "Lost", emoji: "🫠" },
];
export const rating = (total, max = MAX_SCORE) => RATINGS.find((r) => total >= r.min * max);
export const ratingFor = (total, max = MAX_SCORE) => {
  const r = rating(total, max);
  return `${r.label} ${r.emoji}`;
};

// Everything recorded about a finished round. `satellite`: guessed from the
// satellite photo without revealing the name.
export const evaluateGuess = (guess, location, multiplier = 1, options = {}) => {
  const distanceKm = haversineKm(guess, location);
  return { guess, distanceKm, ...scoreRound(distanceKm, multiplier, options), tier: tierFor(distanceKm) };
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
//   596 / 1,000 · Tourist 📸
//   https://gabarker.com/tapmap
export const shareText = ({ title, rounds, max = MAX_SCORE, url = GAME_URL }) => {
  const total = totalScore(rounds);
  return [
    title,
    rounds.map((r) => `${r.tier} ${r.score}`).join(" "),
    `${formatNumber(total)} / ${formatNumber(max)} · ${ratingFor(total, max)}`,
    url,
  ].join("\n");
};

// ---------- Weeks (for the league) ----------

// The Monday on or before `dateKey` (weeks run Monday to Sunday).
export const weekStart = (dateKey) => {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return new Date(Date.parse(dateKey) - ((day + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
};

// ---------- Challenge links ----------

// A short code per place, so a challenge link doesn't spell out the answers.
export const placeCode = (name) => hashString(`tapmap:place:${name}`).toString(36);

const toBase64Url = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromBase64Url = (code) => {
  const binary = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
};

// { by, kind: "daily" | "practice" | "satellite", number?, places: [name…],
//   rounds: [{ score, km, tier }…] } -> URL-safe string, and back.
export const encodeChallenge = ({ by, kind, number, places, rounds }) =>
  toBase64Url(JSON.stringify({
    v: 1,
    b: by ? String(by).slice(0, 40) : undefined,
    k: kind,
    n: number,
    p: places.map(placeCode),
    r: rounds.map((r) => [r.score, Math.round(r.distanceKm * 10) / 10]),
  }));

export const decodeChallenge = (code) => {
  try {
    const d = JSON.parse(fromBase64Url(String(code)));
    const kinds = ["daily", "practice", "satellite"];
    const valid = d && d.v === 1 && kinds.includes(d.k)
      && Array.isArray(d.p) && d.p.length === ROUNDS && d.p.every((p) => typeof p === "string" && p.length <= 8)
      && Array.isArray(d.r) && d.r.length === ROUNDS
      && d.r.every((r) => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[0] >= 0 && r[0] <= ROUND_MAX && r[1] >= 0)
      && (d.n === undefined || (Number.isInteger(d.n) && d.n > 0));
    if (!valid) return null;
    return {
      by: typeof d.b === "string" && d.b.trim() ? d.b.trim().slice(0, 40) : null,
      kind: d.k,
      number: d.n,
      codes: d.p,
      rounds: d.r.map(([score, km]) => ({ score, distanceKm: km, tier: tierFor(km) })),
    };
  } catch (e) {
    return null;
  }
};

// The places a challenge refers to, looked up by code; null if any is missing.
export const resolvePlaces = (codes, locations) => {
  const byCode = new Map(locations.map((l) => [placeCode(l.name), l]));
  const found = codes.map((c) => byCode.get(c));
  return found.every(Boolean) ? found : null;
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
