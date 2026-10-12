// Formatting shared by the GeoBarkr pages, matching the ServiceNow app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTime, roundDistance, formatDistance, formatScore, ordinal, firstName, parseStreetViewLink } from "../js/geo.js";

test("time taken reads like ServiceNow's _formatTimeField", () => {
  assert.equal(formatTime(0), "0s");
  assert.equal(formatTime(12_900), "12s");
  assert.equal(formatTime(192_000), "3min 12s");
  assert.equal(formatTime(null), "0s");
});

test("distances round to whole km from 10 km, else to 0.1 km", () => {
  assert.equal(roundDistance(1234.5), 1235);
  assert.equal(roundDistance(9.96), 10);
  assert.equal(roundDistance(3.25), 3.3);
  assert.equal(formatDistance(1667), "1,667");
});

test("scores and places", () => {
  assert.equal(formatScore(4797.9), "4,797");
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  assert.equal(firstName("George Barker"), "George");
  assert.equal(firstName(""), "there");
});

test("admin: Street View links fill in place and view", () => {
  assert.deepEqual(parseStreetViewLink("https://www.google.com/maps/@48.8583701,2.2944813,3a,75y,250.5h,90t/data=!3m6"),
    { lat: 48.8583701, lng: 2.2944813, heading: 250.5, pitch: 0 });
  assert.equal(parseStreetViewLink("https://maps.app.goo.gl/abc"), null);
  assert.equal(parseStreetViewLink("https://www.google.com/maps/@-33.85,151.21,3a,75y,10h,180t").pitch, 90);
});
