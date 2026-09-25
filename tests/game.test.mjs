// Scoring, ratings, streaks, weeks and challenge links: `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BULLSEYE_KM, MAX_SCORE, PHOTO_PLAN, ROUND_PLAN,
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

test("photo practice: a photo every round, easy to hard, out of 1,000 like the daily game", () => {
  assert.equal(MAX_SCORE, 1000);
  assert.equal(maxScoreFor(ROUND_PLAN), 1000);
  assert.equal(maxScoreFor(PHOTO_PLAN), 1000);
  assert.ok(PHOTO_PLAN.every((r) => r.photo));
  assert.deepEqual(PHOTO_PLAN.map((r) => r.difficulty), ROUND_PLAN.map((r) => r.difficulty));
  assert.deepEqual(PHOTO_PLAN.map((r) => r.multiplier), ROUND_PLAN.map((r) => r.multiplier));
  const perfect = scoreRound(0, 3, { photo: true });
  assert.equal(perfect.score, 100);
  assert.equal(perfect.weighted, 300);
  assert.equal(perfect.sat, true);
  assert.equal(scoreRound(0, 3).score, 100);
  const rounds = PHOTO_PLAN.map((r) => evaluateGuess({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }, r.multiplier, { photo: Boolean(r.photo) }));
  assert.equal(totalScore(rounds), 1000);
});

test("photo practice picks five different places, easy to hard", () => {
  for (let i = 0; i < 50; i++) {
    const picks = practiceLocations(poolFor("2026-10-05", LOCATIONS), Math.random, PHOTO_PLAN);
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
  const rounds = places.map((l, i) => ({ score: 50 + i, distanceKm: 123.45 + i, guess: { lat: 10.123456 + i, lng: -170.98765 } }));
  const code = encodeChallenge({ by: "Zoë", username: "zoe_b", kind: "daily", number: 12, places: places.map((l) => l.name), rounds });
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  for (const place of places) assert.ok(!Buffer.from(code, "base64url").toString().includes(place.name.split(",")[0]));
  const back = decodeChallenge(code);
  assert.equal(back.by, "Zoë");
  assert.equal(back.number, 12);
  assert.deepEqual(back.rounds.map((r) => r.score), [50, 51, 52, 53, 54]);
  assert.equal(back.username, "zoe_b");
  assert.deepEqual(back.rounds[0].guess, { lat: 10.12, lng: -170.99 }); // the sender's pin, to about 1 km
  // Links made before guesses were included still work, with no pin.
  const noPins = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(code, "base64url").toString()), u: undefined, r: rounds.map((r) => [r.score, 5]) })).toString("base64url");
  assert.deepEqual(decodeChallenge(noPins).rounds.map((r) => r.guess), [null, null, null, null, null]);
  assert.deepEqual(resolvePlaces(back.codes, LOCATIONS).map((l) => l.name), places.map((l) => l.name));
  assert.equal(decodeChallenge("not-a-challenge"), null);
  // Links made when photo practice was called satellite still work.
  const old = encodeChallenge({ kind: "photo", places: places.map((l) => l.name), rounds });
  const legacy = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(old, "base64url").toString()), k: "satellite" })).toString("base64url");
  assert.equal(decodeChallenge(legacy).kind, "photo");
  assert.equal(decodeChallenge(encodeChallenge({ kind: "daily", places: ["a"], rounds: [] })), null);
});
