// Daily place picker: run with `node --test tests/` (or `npm test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LAUNCH_DATE, PICKER_START, ROUND_PLAN, dailyLocations, nextDateKey, poolFor,
} from "../tapmap/game.js";
import { LOCATIONS } from "../tapmap/locations.js";

const DAYS = 365;
const names = (picks) => picks.map((l) => l.name);

function days(from, count) {
  const keys = [];
  for (let key = from; keys.length < count; key = nextDateKey(key)) keys.push(key);
  return keys;
}
const YEAR = days(PICKER_START, DAYS);

// Picks made by the original picker (before this change), for dates before
// PICKER_START. These must never change.
const ORIGINAL = {
  "2026-01-01": ["Machu Picchu, Peru", "Victoria Falls, Zambia/Zimbabwe", "Uluru, Australia", "Koror, Palau", "Tristan da Cunha"],
  "2026-06-15": ["Statue of Liberty, New York, USA", "Great Barrier Reef, Australia", "Auckland, New Zealand", "Sossusvlei, Namibia", "Apia, Samoa"],
  "2026-09-20": ["Taj Mahal, Agra, India", "Mexico City, Mexico", "Serengeti, Tanzania", "Sossusvlei, Namibia", "Ushuaia, Argentina"],
  "2026-09-23": ["Niagara Falls, Canada/USA", "Singapore", "Angkor Wat, Cambodia", "Suva, Fiji", "Nazca Lines, Peru"],
  "2026-09-24": ["Great Wall at Badaling, China", "Victoria Falls, Zambia/Zimbabwe", "Havana, Cuba", "Suva, Fiji", "Cradle Mountain, Tasmania, Australia"],
  "2026-09-25": ["Golden Gate Bridge, San Francisco, USA", "Galápagos Islands, Ecuador", "Kyoto, Japan", "Koror, Palau", "Samarkand, Uzbekistan"],
  "2026-09-26": ["Machu Picchu, Peru", "Iguazu Falls, Argentina/Brazil", "Stonehenge, England", "Nazca Lines, Peru", "Socotra, Yemen"],
};

test("games before the start date keep exactly the original places", () => {
  assert.ok(PICKER_START > LAUNCH_DATE);
  for (const [date, expected] of Object.entries(ORIGINAL)) {
    assert.deepEqual(names(dailyLocations(date, LOCATIONS)), expected, date);
  }
});

test("365 days: five places a day, easy → hard, all different", () => {
  for (const date of YEAR) {
    const picks = dailyLocations(date, LOCATIONS);
    assert.equal(picks.length, ROUND_PLAN.length, date);
    picks.forEach((loc, i) => assert.equal(loc.difficulty, ROUND_PLAN[i].difficulty, date));
    assert.equal(new Set(names(picks)).size, picks.length, date);
  }
});

test("365 days: the same every time, and later places can be listed anywhere", () => {
  // Places are matched by name, so where new rows sit in the list (database
  // id order, or the built-in list) doesn't matter.
  const later = [
    { name: "Later Place A", lat: 1, lng: 1, difficulty: "easy", added_on: "2026-10-05" },
    { name: "Later Place B", lat: 2, lng: 2, difficulty: "medium", added_on: "2026-11-20" },
    { name: "Later Place C", lat: 3, lng: 3, difficulty: "hard", added_on: "2026-12-24" },
  ];
  const atEnd = [...LOCATIONS, ...later];
  const mixed = [later[2], ...LOCATIONS.slice(0, 30), later[0], ...LOCATIONS.slice(30), later[1]];
  const copied = atEnd.map((l) => ({ ...l }));
  for (const date of YEAR) {
    const expected = names(dailyLocations(date, atEnd));
    assert.deepEqual(names(dailyLocations(date, mixed)), expected, date);
    assert.deepEqual(names(dailyLocations(date, copied)), expected, date);
  }
});

// Walks the year and checks that, at each difficulty, a place only comes back
// once every place live that day has been shown since the list last ran out.
function assertNoEarlyRepeats(locations, dates) {
  for (const level of new Set(ROUND_PLAN.map((r) => r.difficulty))) {
    let seen = new Set();
    let cycles = 0;
    for (const date of dates) {
      const live = poolFor(date, locations).filter((l) => l.difficulty === level).map((l) => l.name);
      for (const loc of dailyLocations(date, locations).filter((l) => l.difficulty === level)) {
        if (seen.has(loc.name)) {
          const unseen = live.filter((name) => !seen.has(name));
          assert.deepEqual(unseen, [], `${date}: ${loc.name} (${level}) repeated before ${unseen.join(", ")}`);
          seen = new Set();
          cycles += 1;
        }
        seen.add(loc.name);
      }
    }
    assert.ok(cycles > 5, `${level} should cycle several times in a year`);
  }
}

test("365 days: no place repeats until its difficulty's list is used up", () => {
  // The days since launch before the start date count towards the first cycle.
  assertNoEarlyRepeats(LOCATIONS, days(LAUNCH_DATE, DAYS + 1));
});

test("365 days: no place from the last week comes back", () => {
  const history = [];
  let weekRepeats = 0;
  for (const date of YEAR) {
    const today = names(dailyLocations(date, LOCATIONS));
    if (history.slice(-7).some((day) => today.some((n) => day.includes(n)))) weekRepeats += 1;
    history.push(today);
  }
  // The original picker repeated last week's places on 346 of these 365 days.
  assert.equal(weekRepeats, 0, `repeated last week's places on ${weekRepeats} of ${DAYS} days`);
});

test("adding a place changes nothing before the day it joins, and it is shown within a cycle", () => {
  const added = "2027-02-01";
  const extra = { name: "Test Place, Nowhere", lat: 10, lng: 10, difficulty: "hard", added_on: "2027-01-31" };
  const withExtra = [...LOCATIONS, extra];
  let shownOn = null;
  for (const date of YEAR) {
    const before = names(dailyLocations(date, LOCATIONS));
    const after = names(dailyLocations(date, withExtra));
    if (date < added) assert.deepEqual(after, before, date);
    if (!shownOn && after.includes(extra.name)) shownOn = date;
  }
  const hard = LOCATIONS.filter((l) => l.difficulty === "hard").length + 1;
  const perDay = ROUND_PLAN.filter((r) => r.difficulty === "hard").length;
  assert.ok(shownOn, "the new place is picked");
  assert.ok((Date.parse(shownOn) - Date.parse(added)) / 86400000 < 2 * Math.ceil(hard / perDay));
  assertNoEarlyRepeats(withExtra, days(LAUNCH_DATE, DAYS + 1));
});

test("retiring a place changes nothing before it goes, and it never appears after", () => {
  const retiredOn = "2027-03-10";
  const target = dailyLocations(retiredOn, LOCATIONS)[1].name;
  const withRetired = LOCATIONS.map((l) => (l.name === target ? { ...l, retired_on: retiredOn } : l));
  for (const date of YEAR) {
    const before = names(dailyLocations(date, LOCATIONS));
    const after = names(dailyLocations(date, withRetired));
    if (date < retiredOn) assert.deepEqual(after, before, date);
    else assert.ok(!after.includes(target), `${date} still shows ${target}`);
  }
  assertNoEarlyRepeats(withRetired, days(LAUNCH_DATE, DAYS + 1));
});
