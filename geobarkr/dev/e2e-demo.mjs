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
  await d.page.waitForSelector("#map-select option[value]:not([value=''])", { state: "attached" });
}
async function chooseMap(page, name) {
  const value = await page.$eval("#map-select", (s, n) => [...s.options].find((o) => o.textContent.includes(n)).value, name);
  await page.selectOption("#map-select", value);
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
    await me.page.waitForSelector("#map-select option[value]:not([value=''])", { state: "attached" });
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
    await me.page.waitForSelector("#map-select option[value]:not([value=''])", { state: "attached" });
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

  await me.context.close();
}

await browser.close();
if (errors.length) console.log(`\nBrowser errors:\n${[...new Set(errors)].join("\n")}`);
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed. Screenshots in ${OUT}`);
process.exit(passed === results.length && !errors.length ? 0 : 1);
