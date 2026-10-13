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

test("place names from reverse geocoding read like Mayfair, London, UK", async () => {
  const { placeLabel } = await import("../js/geo.js");
  const c = (long_name, types, short_name = long_name) => ({ long_name, short_name, types });
  assert.equal(placeLabel([
    c("12", ["street_number"]), c("Mount Street", ["route"]), c("Mayfair", ["neighborhood", "political"]),
    c("London", ["postal_town"]), c("Greater London", ["administrative_area_level_2"]),
    c("England", ["administrative_area_level_1"]), c("United Kingdom", ["country"], "GB"),
  ]), "Mayfair, London, UK");
  assert.equal(placeLabel([c("Reykjavík", ["locality"]), c("Iceland", ["country"], "IS")]), "Reykjavík, Iceland");
  assert.equal(placeLabel([c("Tasmania", ["administrative_area_level_1"]), c("Australia", ["country"], "AU")]), "Tasmania, Australia");
  assert.equal(placeLabel([]), "");
});
