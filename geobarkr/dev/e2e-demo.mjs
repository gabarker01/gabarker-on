// End-to-end checks of demo mode (no Supabase): start the stack with
//   DEMO=1 geobarkr/dev/start.sh
// then run
//   node geobarkr/dev/e2e-demo.mjs [screenshot folder]
// Google Maps is replaced by dev/fake-google-maps.js. To check the keyless
// maps instead, start the stack with GOOGLE_MAPS_KEY= as well and run with
// KEYLESS=1 (map tiles and the Street View embed are stubbed).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { withGps } from "../tests/exif-fixture.mjs";

const require = createRequire(process.env.PLAYWRIGHT_MODULE || import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:8080";
const OUT = process.argv[2] || "/tmp/geobarkr-demo-shots";
fs.mkdirSync(OUT, { recursive: true });
const FAKE_MAPS = fs.readFileSync(new URL("./fake-google-maps.js", import.meta.url), "utf8");
const KEYLESS = process.env.KEYLESS === "1";
// A dark 1×1 PNG for every map tile.
const TILE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const results = [];
const errors = [];
const browser = await chromium.launch();

async function device(label, viewport) {
  const mobile = viewport.width < 600;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
  await context.route(/maps\.googleapis\.com/, (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_MAPS }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.continue());
  await context.route(/basemaps\.cartocdn\.com/, (route) => route.fulfill({ contentType: "image/png", body: TILE }));
  await context.route(/www\.google\.com\/maps/, (route) => route.fulfill({ contentType: "text/html", body: `<body style="margin:0;background:#3a5a40;color:#fff;font:20px sans-serif;display:grid;place-items:center;height:100vh">Street View embed: ${new URL(route.request().url()).searchParams.get("cbll")}</body>` }));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  return { label, page, context, size: mobile ? "phone" : "desktop" };
}
const shot = (d, name, full = false) => d.page.screenshot({ path: path.join(OUT, `${name}-${d.size}.png`), fullPage: full });
async function step(name, fn) {
  try { await fn(); results.push(true); console.log(`ok - ${name}`); }
  catch (e) { results.push(false); console.log(`not ok - ${name}\n  ${e.message.split("\n")[0]}`); }
}
async function tapMap(page, fx, fy) {
  // On the play screen the map waits in a bubble: open it first.
  if (await page.locator("#open-map").isVisible().catch(() => false)) {
    await page.click("#open-map");
    await page.waitForFunction(() => document.querySelector("#guess-panel")?.getBoundingClientRect().width > 250);
    await page.waitForTimeout(600);
  }
  const box = await page.locator("#map").boundingBox();
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}
async function signIn(d, name) {
  await d.page.goto(`${BASE}/geobarkr/`);
  await d.page.waitForURL(/\/signin\//);
  await d.page.waitForSelector("#demo-form:not([hidden])");
  await d.page.waitForTimeout(600);
  await shot(d, "signin");
  await d.page.fill("#demo-form input[name=name]", name);
  await d.page.click("#demo-form button");
  await d.page.waitForURL(`${BASE}/geobarkr/`);
  await d.page.waitForSelector("#map-button:not([disabled])");
}
async function chooseMap(page, name) {
  await page.click("#map-button");
  await page.click(`#map-list .gb-pick[data-name="${name}"]`);
  await page.waitForFunction((n) => document.querySelector("#map-name")?.textContent === n, name);
}
const SPOTS = [[0.29, 0.27], [0.88, 0.3], [0.55, 0.69], [0.44, 0.14], [0.34, 0.69]]; // World tour, roughly

for (const [label, viewport] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 800 }]]) {
  const me = await device(label, viewport);

  await step(`${label}: demo sign-in with just a name`, async () => {
    await signIn(me, label === "phone" ? "George Barker" : "Sam Desk");
    assert.match(await me.page.textContent(".gb-demo-note"), /Demo mode/);
    await me.page.waitForTimeout(600);
    await shot(me, "landing-empty");
  });

  await step(`${label}: solo game, five rounds, results`, async () => {
    await chooseMap(me.page, "World tour");
    await me.page.click("#modes [data-type=single_player]");
  await me.page.click("#play-button");
    await me.page.waitForURL(/\/play\//);
    await me.page.waitForSelector("#round-label");
    assert.equal(await me.page.isDisabled("#guess"), true);
    for (let round = 1; round <= 5; round++) {
      await me.page.waitForFunction((n) => document.querySelector("#round-label")?.textContent === `Round ${n}`, round);
      await tapMap(me.page, ...SPOTS[round - 1]);
      assert.match(await me.page.textContent("#coords"), /° [NS], .*° [EW]/);
      if (round === 1) {
      if (KEYLESS) await me.page.waitForSelector("#pano iframe.gb-sv-embed", { state: "attached" });
      await shot(me, "play");
    }
      await me.page.click("#guess");
      await me.page.waitForSelector("#results:not([hidden])");
      assert.match(await me.page.textContent("#results-summary"), /km away/);
      assert.ok((await me.page.textContent("#results-place")).length > 3, "place name shown");
      if (round === 1) { await me.page.waitForTimeout(400); await shot(me, "reveal-solo"); }
      await me.page.click("#continue");
    }
    await me.page.waitForURL(/\/results\//);
    await me.page.waitForSelector("#rounds .gb-round");
    await me.page.waitForTimeout(500);
    await shot(me, "results-solo", true);
  });

  await step(`${label}: online game against bots, live guesses, results`, async () => {
    await me.page.goto(`${BASE}/geobarkr/`);
    await me.page.waitForSelector("#map-button:not([disabled])");
    await chooseMap(me.page, "World tour");
    await me.page.click("#modes [data-type=multiplayer]");
  await me.page.click("#play-button");
    await me.page.waitForURL(/\/lobby\//);
    await me.page.waitForFunction(() => document.querySelectorAll("#players .gb-line").length === 3, null, { timeout: 15000 });
    await me.page.waitForSelector("#qr svg, .gb-qr svg");
    await shot(me, "lobby");
    await me.page.click("#start-button");
    await me.page.waitForURL(/\/play\//);
    await tapMap(me.page, ...SPOTS[0]);
    await me.page.click("#guess");
    await me.page.waitForSelector("#waiting:not([hidden])");
    await shot(me, "waiting");
    await me.page.waitForSelector("#results:not([hidden])", { timeout: 30000 });
    await me.page.waitForTimeout(400);
    assert.equal(await me.page.locator("#results-ranked .gb-bar-row").count(), 3);
    await shot(me, "reveal-online");
    // Round 2: end it before the bots guess.
    await me.page.click("#continue");
    await me.page.waitForFunction(() => document.querySelector("#round-label")?.textContent === "Round 2");
    assert.equal(await me.page.isHidden("#end-round"), true, "End round only after the host has guessed");
    await tapMap(me.page, ...SPOTS[1]);
    await me.page.click("#guess");
    await me.page.click("#end-round");
    await me.page.waitForSelector("#results:not([hidden])");
    await me.page.click("#continue");
    for (let round = 3; round <= 5; round++) {
      await me.page.waitForFunction((n) => document.querySelector("#round-label")?.textContent === `Round ${n}`, round);
      await tapMap(me.page, ...SPOTS[round - 1]);
      await me.page.click("#guess");
      await me.page.waitForSelector("#results:not([hidden])", { timeout: 30000 });
      await me.page.click("#continue");
    }
    await me.page.waitForURL(/\/results\//);
    await me.page.waitForSelector("#standings .gb-standing");
    await me.page.waitForTimeout(500);
    await shot(me, "results-online", true);
  });

  await step(`${label}: party game hosted with bots on phones`, async () => {
    await me.page.goto(`${BASE}/geobarkr/`);
    await me.page.waitForSelector("#map-button:not([disabled])");
    await chooseMap(me.page, "GeoBarkr Demo");
    await me.page.click("#modes [data-type=local_multiplayer]");
  await me.page.click("#play-button");
    await me.page.waitForURL(/\/lobby\//);
    await me.page.waitForFunction(() => document.querySelectorAll("#players .gb-line").length === 3, null, { timeout: 15000 });
    await me.page.waitForTimeout(300);
    await shot(me, "lobby-party");
    await me.page.click("#start-button");
    await me.page.waitForURL(/\/host\//);
    await me.page.waitForFunction(() => document.querySelectorAll("#guess-list .gb-line").length >= 1, null, { timeout: 30000 });
    await shot(me, "host-live");
    await me.page.click("#end-round");
    await me.page.waitForSelector("#results:not([hidden])");
    await me.page.waitForTimeout(400);
    assert.match(await me.page.textContent("#results-summary"), /Closest|Nobody/);
    await shot(me, "host-reveal");
  });

  await step(`${label}: my games, leaderboard, landing with last game, admin`, async () => {
    await me.page.goto(`${BASE}/geobarkr/games/`);
    console.log("  · my games");
    await me.page.waitForSelector("#games .gb-line");
    await me.page.waitForTimeout(700);
    assert.ok(await me.page.locator("#games .gb-thumb svg").count() >= 2, "thumbnails drawn");
    await shot(me, "my-games", true);
    console.log("  · leaderboard");
    await me.page.goto(`${BASE}/geobarkr/leaderboard/`);
    await me.page.waitForSelector("#rows, #podium");
    await me.page.waitForTimeout(700);
    await shot(me, "leaderboard", true);
    console.log("  · landing");
    await me.page.goto(`${BASE}/geobarkr/`);
    await me.page.waitForSelector("#home-chip:not([hidden])");
    await me.page.waitForTimeout(700);
    await shot(me, "landing", true);
    console.log("  · admin");
    await me.page.goto(`${BASE}/geobarkr/admin/`);
    await me.page.waitForSelector("#maps .gb-line");
    await shot(me, "admin", true);
  });

  await step(`${label}: profile from your picture, with your numbers`, async () => {
    await me.page.goto(`${BASE}/geobarkr/`);
    await me.page.click(".gb-header .gb-me");
    await me.page.waitForURL(/\/profile\//);
    await me.page.waitForSelector("#stats .gb-stat");
    assert.equal(await me.page.locator("#stats .gb-stat").count(), 8);
    assert.equal(await me.page.textContent("#stats .gb-stat:first-child b"), "2", "two finished games");
    assert.equal(await me.page.isVisible("#maps-empty"), true, "no maps yet");
    await me.page.waitForTimeout(900);
    await shot(me, "profile", true);
  });

  await step(`${label}: make a Street View map`, async () => {
    await me.page.click("#create-map");
    await me.page.waitForSelector("#new:not([hidden])");
    await me.page.fill("#new-form input[name=name]", "Corners");
    await me.page.fill("#new-description", "Five street corners");
    await shot(me, "map-new");
    await me.page.click("#create-button");
    for (let place = 1; place <= 5; place++) {
      if (place > 1) await me.page.click(`#slots .gb-slot:nth-child(${place})`);
      await me.page.waitForFunction(() => document.querySelector("#editor")?.open);
      await me.page.waitForTimeout(450);
      if (place === 1 && !KEYLESS) {
        await me.page.fill("#search", "Tokyo");
        await me.page.press("#search", "Enter");
        await me.page.waitForFunction(() => document.querySelector("#place-name").value === "Shibuya, Tokyo, Japan");
      } else {
        const box = await me.page.locator("#editor-map").boundingBox();
        await me.page.mouse.click(box.x + box.width * (0.15 + place * 0.13), box.y + box.height * 0.42);
      }
      await me.page.waitForFunction(() => !document.querySelector("#editor-save").disabled);
      if (place === 1) { await me.page.waitForTimeout(400); await shot(me, "map-editor-streetview"); }
      await me.page.click("#editor-save");
      await me.page.waitForFunction(() => !document.querySelector("#editor").open);
    }
    await me.page.waitForSelector("#ready.is-ready");
    assert.equal(await me.page.locator("#slots .gb-slot:not(.is-empty)").count(), 5);
    await me.page.waitForTimeout(500);
    await shot(me, "map-ready", true);
  });

  await step(`${label}: make a private photo map; the place comes from the photo`, async () => {
    // A landscape JPEG from the browser, then GPS tags for Mayfair added to it.
    const jpeg = Buffer.from(await me.page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1200; c.height = 700;
      const g = c.getContext("2d");
      const sky = g.createLinearGradient(0, 0, 0, 700);
      sky.addColorStop(0, "#4A7BC8"); sky.addColorStop(1, "#F2B263");
      g.fillStyle = sky; g.fillRect(0, 0, 1200, 700);
      g.fillStyle = "#1D2333";
      for (let x = 0; x < 1200; x += 90) g.fillRect(x, 420 - (x % 270) / 2, 60, 300);
      return c.toDataURL("image/jpeg", 0.9).split(",")[1];
    }), "base64");
    const withPlace = Buffer.from(withGps(jpeg, 51.5098, -0.1478));
    await me.page.goto(`${BASE}/geobarkr/map/`);
    await me.page.click("[data-kind=photo]");
    await me.page.fill("#new-form input[name=name]", "Snaps");
    await me.page.click('#new-visibility [data-public="false"]');
    await me.page.click("#create-button");
    for (let place = 1; place <= 5; place++) {
      if (place > 1) await me.page.click(`#slots .gb-slot:nth-child(${place})`);
      await me.page.waitForFunction(() => document.querySelector("#editor")?.open);
      await me.page.waitForTimeout(400);
      const located = place !== 2;
      await me.page.setInputFiles("#photo-input", { name: `snap${place}.jpg`, mimeType: "image/jpeg", buffer: located ? withPlace : jpeg });
      if (located) {
        await me.page.waitForFunction(() => /where the photo was taken/.test(document.querySelector("#editor-status").textContent));
        if (!KEYLESS) await me.page.waitForFunction(() => document.querySelector("#place-name").value === "Mayfair, London, UK");
      } else {
        await me.page.waitForFunction(() => /doesn't say where/.test(document.querySelector("#editor-status").textContent));
        assert.equal(await me.page.isDisabled("#editor-save"), true, "needs a place first");
        const box = await me.page.locator("#editor-map").boundingBox();
        await me.page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
      }
      await me.page.waitForFunction(() => !document.querySelector("#editor-save").disabled);
      if (place === 1) { await me.page.waitForTimeout(700); await shot(me, "map-editor-photo"); }
      await me.page.click("#editor-save");
      await me.page.waitForFunction(() => !document.querySelector("#editor").open);
    }
    await me.page.waitForSelector("#ready.is-ready");
    assert.match(await me.page.textContent("#ready"), /Only you/);
    await shot(me, "map-photo-ready", true);
  });

  await step(`${label}: maps show their kind in the picker; play a photo round`, async () => {
    await me.page.goto(`${BASE}/geobarkr/profile/`);
    await me.page.waitForSelector("#maps .gb-card");
    assert.equal(await me.page.locator("#maps .gb-card").count(), 2);
    await me.page.click("#maps .gb-card:has-text('Snaps') .gb-card-body");
    await me.page.waitForURL(/\/map\/\?id=/);
    await me.page.click("#ready a.gb-btn");
    await me.page.waitForFunction(() => document.querySelector("#map-name")?.textContent === "Snaps");
    await me.page.click("#map-button");
    await me.page.waitForSelector("#map-list .gb-pick[data-kind=photo]");
    await me.page.click("#map-kinds [data-kind=photo]");
    assert.equal(await me.page.locator("#map-list .gb-pick").count(), 1, "filter to photo maps");
    await me.page.waitForTimeout(500);
    await shot(me, "picker-kinds");
    await me.page.click('#map-list .gb-pick[data-name="Snaps"]');
    await me.page.click("#modes [data-type=single_player]");
    await me.page.click("#play-button");
    await me.page.waitForURL(/\/play\//);
    await me.page.waitForSelector(".gb-sv.is-photo .gb-photo.is-loaded");
    await me.page.waitForTimeout(700);
    await shot(me, "play-photo");
    // Zoom in (double tap / double click), then back with the recentre button.
    const photo = await me.page.locator(".gb-photo").boundingBox();
    if (me.size === "phone") {
      await me.page.touchscreen.tap(photo.x + photo.width / 2, photo.y + photo.height / 2);
      await me.page.waitForTimeout(60);
      await me.page.touchscreen.tap(photo.x + photo.width / 2, photo.y + photo.height / 2);
    } else {
      await me.page.mouse.move(photo.x + photo.width / 2, photo.y + photo.height / 2);
      await me.page.mouse.wheel(0, -500);
    }
    await me.page.waitForSelector(".gb-photo.is-zoomed");
    await me.page.waitForTimeout(600);
    await shot(me, "play-photo-zoomed");
    await me.page.click("#home");
    await me.page.waitForFunction(() => !document.querySelector(".gb-photo").classList.contains("is-zoomed"));
    await tapMap(me.page, 0.49, 0.25);
    await me.page.click("#guess");
    await me.page.waitForSelector("#results:not([hidden])");
    assert.match(await me.page.textContent("#results-place"), /Mayfair|London|\w/);
  });

  await me.context.close();
}

await browser.close();
if (errors.length) console.log(`\nBrowser errors:\n${[...new Set(errors)].join("\n")}`);
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed. Screenshots in ${OUT}`);
process.exit(passed === results.length && !errors.length ? 0 : 1);
