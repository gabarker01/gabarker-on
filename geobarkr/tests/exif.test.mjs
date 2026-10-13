// Reading where a photo was taken (photo maps).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readExifGps } from "../js/exif.js";
import { withGps } from "./exif-fixture.mjs";

// The smallest useful JPEG: start, a comment, start of scan, end.
const PLAIN = new Uint8Array([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x04, 0x68, 0x69, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
const buffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test("reads GPS from little- and big-endian EXIF", () => {
  for (const littleEndian of [true, false]) {
    const gps = readExifGps(buffer(withGps(PLAIN, 51.5098, -0.1478, { littleEndian })));
    assert.ok(Math.abs(gps.lat - 51.5098) < 1e-4);
    assert.ok(Math.abs(gps.lng + 0.1478) < 1e-4);
  }
  const south = readExifGps(buffer(withGps(PLAIN, -33.8568, 151.2153)));
  assert.ok(south.lat < 0 && south.lng > 0);
});

test("no location: plain JPEGs, other files, broken files", () => {
  assert.equal(readExifGps(buffer(PLAIN)), null);
  assert.equal(readExifGps(new TextEncoder().encode("not a photo").buffer), null);
  assert.equal(readExifGps(buffer(withGps(PLAIN, 51.5, -0.1).slice(0, 40))), null);
  assert.equal(readExifGps(buffer(withGps(PLAIN, 0, 0))), null);
});
