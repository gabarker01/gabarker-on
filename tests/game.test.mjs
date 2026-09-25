// Scoring, ratings, streaks, weeks and challenge links: `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BULLSEYE_KM, MAX_SCORE, SATELLITE_MAX_SCORE, SATELLITE_PLAN, ROUND_PLAN,
  scoreRound, tierFor, rating, ratingFor, maxScoreFor, currentStreak, recordDailyResult,
  weekStart, encodeChallenge, decodeChallenge, resolvePlaces, dailyLocations, totalScore, evaluateGuess,
} from "../tapmap/game.js";
import { LOCATIONS } from "../tapmap/locations.js";

test("one bullseye distance: the 🎯 band and the bonus both stop at 25 km", () => {
  assert.equal(BULLSEYE_KM, 25);
  assert.equal(tierFor(24.9), "🎯");
  assert.equal(scoreRound(24.9).bullseye, true);
  assert.equal(tierFor(25), "🟩");
  assert.equal(scoreRound(25).bullseye, false);
  assert.equal(tierFor(40), "🟩"); // was 🎯 when the band was 50 km
});

test("every rating has an emoji, out of the game's own maximum", () => {
  for (const total of [0, 400, 700, 900, 1000]) assert.match(ratingFor(total), /^\S+ \p{Extended_Pictographic}/u);
  assert.equal(rating(900).label, "Cartographer");
  assert.equal(rating(900, SATELLITE_MAX_SCORE).label, "Navigator");
  assert.equal(rating(999, SATELLITE_MAX_SCORE).label, "Cartographer");
});

test("satellite rounds are out of 120, so satellite practice is out of 1,110", () => {
  assert.equal(MAX_SCORE, 1000);
  assert.equal(maxScoreFor(ROUND_PLAN), 1000);
  assert.equal(SATELLITE_MAX_SCORE, 1110);
  assert.deepEqual(SATELLITE_PLAN.map((r) => Boolean(r.satellite)), [false, false, false, true, true]);
  const perfect = scoreRound(0, 3, { satellite: true });
  assert.equal(perfect.score, 120);
  assert.equal(perfect.weighted, 360);
  assert.equal(scoreRound(0, 3).score, 100);
  // A far-off photo guess earns (almost) no bonus.
  assert.equal(scoreRound(15000, 1, { satellite: true }).satBonus, 0);
  const rounds = SATELLITE_PLAN.map((r) => evaluateGuess({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }, r.multiplier, { satellite: Boolean(r.satellite) }));
  assert.equal(totalScore(rounds), 1110);
});

test("a streak counts only if the last daily was today or yesterday", () => {
  let stats = recordDailyResult({}, "2026-10-01", 500);
  stats = recordDailyResult(stats, "2026-10-02", 600);
  assert.equal(currentStreak(stats, "2026-10-02"), 2);
  assert.equal(currentStreak(stats, "2026-10-03"), 2);
  assert.equal(currentStreak(stats, "2026-10-04"), 0);
});

test("weeks run Monday to Sunday", () => {
  assert.equal(weekStart("2026-09-21"), "2026-09-21"); // Monday
  assert.equal(weekStart("2026-09-24"), "2026-09-21");
  assert.equal(weekStart("2026-09-27"), "2026-09-21"); // Sunday
  assert.equal(weekStart("2026-09-28"), "2026-09-28");
});

test("challenge links round-trip without spelling out the places", () => {
  const places = dailyLocations("2026-10-05", LOCATIONS);
  const rounds = places.map((l, i) => ({ score: 50 + i, distanceKm: 123.45 + i }));
  const code = encodeChallenge({ by: "Zoë", kind: "daily", number: 12, places: places.map((l) => l.name), rounds });
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  for (const place of places) assert.ok(!Buffer.from(code, "base64url").toString().includes(place.name.split(",")[0]));
  const back = decodeChallenge(code);
  assert.equal(back.by, "Zoë");
  assert.equal(back.number, 12);
  assert.deepEqual(back.rounds.map((r) => r.score), [50, 51, 52, 53, 54]);
  assert.deepEqual(resolvePlaces(back.codes, LOCATIONS).map((l) => l.name), places.map((l) => l.name));
  assert.equal(decodeChallenge("not-a-challenge"), null);
  assert.equal(decodeChallenge(encodeChallenge({ kind: "daily", places: ["a"], rounds: [] })), null);
});
