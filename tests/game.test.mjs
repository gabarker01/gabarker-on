// Scoring, ratings, streaks, weeks and challenge links: `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BULLSEYE_KM, MAX_SCORE, SATELLITE_PLAN, ROUND_PLAN,
  scoreRound, tierFor, rating, ratingFor, maxScoreFor, currentStreak, recordDailyResult,
  weekStart, practiceLocations, poolFor, encodeChallenge, decodeChallenge, resolvePlaces, dailyLocations, totalScore, evaluateGuess,
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
});

test("satellite practice: a photo every round, easy to hard, out of 1,000 like the daily game", () => {
  assert.equal(MAX_SCORE, 1000);
  assert.equal(maxScoreFor(ROUND_PLAN), 1000);
  assert.equal(maxScoreFor(SATELLITE_PLAN), 1000);
  assert.ok(SATELLITE_PLAN.every((r) => r.satellite));
  assert.deepEqual(SATELLITE_PLAN.map((r) => r.difficulty), ROUND_PLAN.map((r) => r.difficulty));
  assert.deepEqual(SATELLITE_PLAN.map((r) => r.multiplier), ROUND_PLAN.map((r) => r.multiplier));
  const perfect = scoreRound(0, 3, { satellite: true });
  assert.equal(perfect.score, 100);
  assert.equal(perfect.weighted, 300);
  assert.equal(perfect.sat, true);
  assert.equal(scoreRound(0, 3).score, 100);
  const rounds = SATELLITE_PLAN.map((r) => evaluateGuess({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }, r.multiplier, { satellite: Boolean(r.satellite) }));
  assert.equal(totalScore(rounds), 1000);
});

test("satellite practice picks five different places, easy to hard", () => {
  for (let i = 0; i < 50; i++) {
    const picks = practiceLocations(poolFor("2026-10-05", LOCATIONS), Math.random, SATELLITE_PLAN);
    assert.equal(picks.length, 5);
    assert.deepEqual(picks.map((l) => l.difficulty), ["easy", "medium", "medium", "hard", "hard"]);
    assert.equal(new Set(picks.map((l) => l.name)).size, 5);
  }
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
