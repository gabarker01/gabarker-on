// End-to-end checks against the local stack (geobarkr/dev/start.sh), in real
// Chromium at phone and desktop sizes, with several browsers at once.
// Google Maps is replaced by dev/fake-google-maps.js (no key needed).
//
//   node geobarkr/dev/e2e.mjs [screenshot folder]
//
// Needs Playwright (PLAYWRIGHT_MODULE points at it if it isn't installed
// next to this file).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const require = createRequire(process.env.PLAYWRIGHT_MODULE || import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:8080";
const OUT = process.argv[2] || "/tmp/geobarkr-shots";
fs.mkdirSync(OUT, { recursive: true });
const FAKE_MAPS = fs.readFileSync(new URL("./fake-google-maps.js", import.meta.url), "utf8");
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const stamp = Date.now();
const results = [];
const errors = [];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

async function newPlayer(label, viewport) {
  const mobile = viewport.width < 600;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
  await context.route(/maps\.googleapis\.com/, (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_MAPS }));
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(`${label}: ${message.text()}`);
  });
  return { label, context, page, viewport };
}

async function signUp(player, name) {
  const { page } = player;
  await page.goto(`${BASE}/geobarkr/signin/`);
  await page.click("#switch-link");
  await page.fill("#email-form input[name=name]", name);
  player.email = `${name.toLowerCase().replace(/\W+/g, "")}${stamp}@example.com`;
  await page.fill("#email-form input[name=email]", player.email);
  await page.fill("#email-form input[name=password]", "password123");
  await page.click("#email-button");
  await page.waitForURL(`${BASE}/geobarkr/`);
}

const shot = (player, name) => player.page.screenshot({ path: path.join(OUT, `${name}-${player.viewport.width < 600 ? "phone" : "desktop"}.png`) });

async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`ok - ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log(`not ok - ${name}\n  ${error.message.split("\n")[0]}`);
  }
}

// Tap the map at a fraction of its size (the fake map is a flat world map).
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
// Roughly where each demo location is on the flat map (London, London, Paris, Sydney, Rio).
const SPOTS = [[0.5, 0.21], [0.5, 0.215], [0.505, 0.23], [0.92, 0.69], [0.38, 0.63]];

async function create(page, type) {
  await page.goto(`${BASE}/geobarkr/`);
  await page.waitForSelector("#map-select option[value]:not([value=''])", { state: "attached" });
  await page.click(`#modes [data-type=${type}]`);
  await page.click("#play-button");
}

// ---------- Signed out ----------

await step("signed-out visitors are sent to sign in from every page", async () => {
  const visitor = await newPlayer("visitor", PHONE);
  for (const route of ["", "play/?game=x", "lobby/?game=x", "host/?game=x", "party/?game=x", "join/?code=ABCDEF", "results/?game=x", "games/", "leaderboard/", "admin/"]) {
    await visitor.page.goto(`${BASE}/geobarkr/${route}`);
    await visitor.page.waitForURL(/\/geobarkr\/signin\/\?next=/);
  }
  await shot(visitor, "signin");
  const denied = await visitor.page.evaluate(async () => {
    const { getClient } = await import("/geobarkr/js/supabase.js");
    const client = await getClient();
    const rpc = await client.rpc("get_game_state", { p_game: "00000000-0000-0000-0000-000000000000" });
    const maps = await client.from("maps").select("id");
    return { rpc: rpc.error?.message, maps: maps.error?.message };
  });
  assert.match(denied.rpc, /permission denied/);
  assert.match(denied.maps, /permission denied/);
  await visitor.context.close();
});

// ---------- Single player ----------

const solo = await newPlayer("solo", PHONE);
await step("single player: five rounds, scores, results page", async () => {
  await signUp(solo, "Sam Solo");
  await shot(solo, "start");
  await create(solo.page, "single_player");
  await solo.page.waitForURL(/\/play\/\?game=/);
  await solo.page.waitForSelector("#round-label");
  assert.equal(await solo.page.isDisabled("#guess"), true, "Guess is disabled until you tap the map");
  await shot(solo, "play");
  for (let round = 1; round <= 5; round++) {
    await solo.page.waitForFunction((n) => document.querySelector("#round-label")?.textContent === `Round ${n}`, round);
    await tapMap(solo.page, ...SPOTS[round - 1]);
    await solo.page.click("#guess");
    await solo.page.waitForSelector("#results:not([hidden])");
    const summary = await solo.page.textContent("#results-summary");
    assert.match(summary, /[\d,.]+ km away\+[\d,]+/, `round ${round} shows distance and points`);
    if (round === 1) await shot(solo, "reveal-solo");
    await solo.page.click("#continue");
  }
  await solo.page.waitForURL(/\/results\/\?game=/);
  await solo.page.waitForSelector("#rounds .gb-round");
  assert.equal(await solo.page.locator("#rounds .gb-round").count(), 5, "five rounds");
  await solo.page.waitForTimeout(300);
  await solo.page.screenshot({ path: path.join(OUT, "results-solo-phone.png"), fullPage: true });
});

// ---------- Online multiplayer ----------

const host = await newPlayer("online host", DESKTOP);
const guest = await newPlayer("online guest", PHONE);
await step("online: lobby by room code, live guesses, end round, results", async () => {
  await signUp(host, "George Barker");
  await signUp(guest, "Gina Guest");
  await create(host.page, "multiplayer");
  await host.page.waitForURL(/\/lobby\/\?game=/);
  await host.page.waitForSelector("#room-code:not(:empty)");
  const code = (await host.page.textContent("#room-code")).trim();
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.equal(await host.page.isDisabled("#start-button"), true, "can't start alone");
  await host.page.waitForSelector(".gb-qr svg");

  await guest.page.fill("#code", code.toLowerCase());
  await guest.page.click("#join-button");
  await guest.page.waitForURL(/\/lobby\/\?game=/);
  await host.page.waitForFunction(() => document.querySelectorAll("#players .gb-line").length === 2);
  await shot(host, "lobby");
  await shot(guest, "lobby");
  assert.equal(await guest.page.isHidden("#start-button"), true, "only the owner sees Start");

  await host.page.click("#start-button");
  await Promise.all([host.page.waitForURL(/\/play\/\?game=/), guest.page.waitForURL(/\/play\/\?game=/)]);

  // Round 1: host guesses, guest sees the live list, then guesses.
  await tapMap(host.page, ...SPOTS[0]);
  await host.page.click("#guess");
  await host.page.waitForSelector("#waiting:not([hidden])");
  await guest.page.waitForFunction(() => document.querySelector("#guess-list")?.textContent.includes("George Barker"));
  await shot(host, "waiting");
  await tapMap(guest.page, 0.45, 0.25);
  await guest.page.click("#guess");
  await Promise.all([host.page.waitForSelector("#results:not([hidden])"), guest.page.waitForSelector("#results:not([hidden])")]);
  assert.equal(await guest.page.isHidden("#continue"), true, "only the host can go on");
  assert.match(await guest.page.textContent("#results-wait"), /Waiting for George Barker/);
  await host.page.waitForTimeout(400);
  await shot(host, "reveal-online");
  await shot(guest, "reveal-online");
  await host.page.click("#continue");

  // Round 2: the guest doesn't guess; the host ends the round.
  await guest.page.waitForFunction(() => document.querySelector("#round-label")?.textContent === "Round 2");
  await tapMap(host.page, ...SPOTS[1]);
  await host.page.click("#guess");
  await host.page.waitForSelector("#end-round:not([hidden])");
  assert.equal(await guest.page.isHidden("#end-round"), true, "only the host can end the round");
  await host.page.click("#end-round");
  await guest.page.waitForSelector("#results:not([hidden])");
  assert.match(await guest.page.textContent("#results-ranked"), /Gina GuestNo guess0/);
  await host.page.click("#continue");

  for (let round = 3; round <= 5; round++) {
    await guest.page.waitForFunction((n) => document.querySelector("#round-label")?.textContent === `Round ${n}`, round);
    for (const player of [host, guest]) {
      await tapMap(player.page, ...SPOTS[round - 1]);
      await player.page.click("#guess");
    }
    await host.page.waitForSelector("#results:not([hidden])");
    await host.page.click("#continue");
  }
  await Promise.all([host.page.waitForURL(/\/results\//), guest.page.waitForURL(/\/results\//)]);
  await host.page.waitForSelector("#standings .gb-standing");
  assert.equal(await host.page.locator("#standings .gb-standing").count(), 2);
  await host.page.screenshot({ path: path.join(OUT, "results-online-desktop.png"), fullPage: true });
  await guest.page.screenshot({ path: path.join(OUT, "results-online-phone.png"), fullPage: true });
});

// ---------- In person ----------

const partyHost = await newPlayer("party host", DESKTOP);
const phone1 = await newPlayer("phone 1", PHONE);
const phone2 = await newPlayer("phone 2", PHONE);
const lateComer = await newPlayer("late", PHONE);
let partyCode = "";
let partyId = "";
await step("in person: QR join, phones guess, host screen live, end round, results", async () => {
  await signUp(partyHost, "Hannah Host");
  await signUp(phone1, "Pip Phone");
  await signUp(phone2, "Quinn QR");
  await create(partyHost.page, "local_multiplayer");
  await partyHost.page.waitForURL(/\/lobby\/\?game=/);
  partyId = new URL(partyHost.page.url()).searchParams.get("game");
  await partyHost.page.waitForSelector("#room-code:not(:empty)");
  partyCode = (await partyHost.page.textContent("#room-code")).trim();
  await partyHost.page.waitForFunction(() => /Hannah Host is hosting/.test(document.querySelector("#host-note")?.textContent || ""));

  // Phone 1 types the code; phone 2 opens the QR link.
  await phone1.page.fill("#code", partyCode);
  await phone1.page.click("#join-button");
  await phone1.page.waitForSelector("#welcome:not([hidden])");
  await phone2.page.goto(`${BASE}/geobarkr/join/?code=${partyCode}`);
  await phone2.page.waitForSelector("#welcome:not([hidden])");
  assert.match(await phone2.page.textContent("#welcome-title"), /You're in, Quinn QR/);
  await shot(phone2, "join");
  await partyHost.page.waitForFunction(() => document.querySelectorAll("#players .gb-line").length === 2);
  await shot(partyHost, "lobby-in-person");

  await partyHost.page.click("#start-button");
  await partyHost.page.waitForURL(/\/host\/\?game=/);
  await Promise.all([phone1.page.waitForURL(/\/party\/\?game=/), phone2.page.waitForURL(/\/party\/\?game=/)]);
  await phone1.page.waitForFunction(() => document.querySelector("#round-label")?.textContent === "Round 1");
  await shot(phone1, "party-guess");

  // Phones never get the target during the round.
  const leak = await phone1.page.evaluate(async (id) => {
    const { getGameState } = await import("/geobarkr/js/api.js");
    return (await getGameState(id)).round.target;
  }, partyId);
  assert.equal(leak, null, "phone gets no target during the round");

  await tapMap(phone1.page, ...SPOTS[0]);
  await phone1.page.click("#guess");
  await phone1.page.waitForSelector("#status:not([hidden])");
  assert.match(await phone1.page.textContent("#status-title"), /Locked in, Pip/);
  await partyHost.page.waitForFunction(() => document.querySelector("#guess-list")?.textContent.includes("Pip Phone"));
  assert.match(await partyHost.page.textContent("#progress"), /1 of 2/);
  await shot(phone1, "party-waiting");
  await shot(partyHost, "host-live");

  await partyHost.page.click("#end-round");
  await partyHost.page.waitForSelector("#results:not([hidden])");
  await phone1.page.waitForFunction(() => document.querySelector("#status-title")?.textContent === "It was 4 Medley Road");
  await phone2.page.waitForFunction(() => document.querySelector("#status-title")?.textContent === "It was 4 Medley Road");
  assert.match(await phone2.page.textContent("#status-summary"), /ended the round before you guessed/);
  assert.match(await phone1.page.textContent("#status-summary"), /km away\+/);
  await partyHost.page.waitForTimeout(400);
  await shot(partyHost, "host-reveal");
  await shot(phone1, "party-reveal");
  await partyHost.page.click("#continue");

  for (let round = 2; round <= 5; round++) {
    for (const player of [phone1, phone2]) {
      await player.page.waitForFunction((n) => document.querySelector("#round-label")?.textContent === `Round ${n}` && !document.querySelector("#map-box").hidden, round);
      await tapMap(player.page, ...SPOTS[round - 1]);
      await player.page.click("#guess");
    }
    await partyHost.page.waitForSelector("#results:not([hidden])");
    await partyHost.page.click("#continue");
  }
  await Promise.all([partyHost.page.waitForURL(/\/results\//), phone1.page.waitForURL(/\/results\//), phone2.page.waitForURL(/\/results\//)]);
  await partyHost.page.waitForSelector("#standings .gb-standing");
  assert.equal(await partyHost.page.isHidden("#stats"), true, "the host isn't a player");
  await partyHost.page.screenshot({ path: path.join(OUT, "results-in-person-desktop.png"), fullPage: true });
});

await step("joining after the game has started is refused", async () => {
  await signUp(lateComer, "Larry Late");
  await lateComer.page.goto(`${BASE}/geobarkr/join/?code=${partyCode}`);
  await lateComer.page.waitForSelector("#code-error:not([hidden])");
  assert.match(await lateComer.page.textContent("#code-error"), /already started/);
});

// ---------- Row-level security from a player's browser ----------

await step("RLS: a player can't read answers, other games, others' guesses or make themselves admin", async () => {
  const report = await phone1.page.evaluate(async ({ soloGame }) => {
    const { getClient, getSession } = await import("/geobarkr/js/supabase.js");
    const client = await getClient();
    const me = (await getSession()).user.id;
    const out = {};
    out.locations = (await client.from("locations").select("*")).data?.length;
    out.rounds = (await client.from("rounds").select("*")).data?.length;
    out.guesses = (await client.from("guesses").select("player_id")).data;
    out.myPlayerIds = (await client.from("game_players").select("id, user_id")).data.filter((p) => p.user_id === me).map((p) => p.id);
    out.profiles = (await client.from("profiles").select("id")).data?.length;
    out.promote = (await client.from("profiles").update({ role: "admin" }).eq("id", me)).error?.message;
    out.otherGame = (await client.rpc("get_game_state", { p_game: soloGame })).error?.message;
    out.otherGameRow = (await client.from("games").select("id").eq("id", soloGame)).data?.length;
    out.insertMap = (await client.from("maps").insert({ name: "Hack" })).error?.message;
    out.insertGuess = (await client.from("guesses").insert({ round_id: me, player_id: me, lat: 0, lng: 0, distance_km: 0, score: 5000, time_ms: 0 })).error?.message;
    out.forceNext = (await client.rpc("next_round", { p_game: soloGame })).error?.message;
    return out;
  }, { soloGame: new URL(solo.page.url()).searchParams.get("game") });
  assert.equal(report.locations, 0, "locations hidden");
  assert.equal(report.rounds, 0, "rounds hidden");
  assert.ok(report.guesses.every((g) => report.myPlayerIds.includes(g.player_id)), "only own guesses");
  assert.equal(report.profiles, 1, "only own profile");
  assert.match(report.promote, /permission denied/);
  assert.match(report.otherGame, /Game not found/);
  assert.equal(report.otherGameRow, 0);
  assert.match(report.insertMap, /row-level security/);
  assert.match(report.insertGuess, /permission denied/);
  assert.match(report.forceNext, /Only the host/);
  // A game link that isn't yours says so instead of hanging.
  await phone1.page.goto(`${BASE}/geobarkr/play/?game=${new URL(solo.page.url()).searchParams.get("game")}`);
  await phone1.page.waitForSelector("text=Can't open this game");
  await phone1.page.goto(`${BASE}/geobarkr/join/?game=${new URL(solo.page.url()).searchParams.get("game")}`);
  await phone1.page.waitForSelector("#code-error:not([hidden])");
  // The admin page tells non-admins it's for admins only.
  await phone1.page.goto(`${BASE}/geobarkr/admin/`);
  await phone1.page.waitForSelector("#denied:not([hidden])");
});

// ---------- History and leaderboard ----------

await step("my games and the all-time leaderboard", async () => {
  await host.page.goto(`${BASE}/geobarkr/games/`);
  await host.page.waitForSelector("#games .gb-line");
  assert.match(await host.page.textContent("#games"), /GeoBarkr Demo.*Multiplayer/);
  await shot(host, "my-games");
  await guest.page.goto(`${BASE}/geobarkr/leaderboard/`);
  await guest.page.waitForSelector("#podium:not([hidden])");
  const board = await guest.page.textContent("main");
  for (const name of ["Sam Solo", "George Barker", "Gina Guest", "Pip Phone", "Quinn QR"]) assert.ok(board.includes(name), `${name} on the leaderboard`);
  assert.ok(!board.includes("Hannah Host"), "hosts who didn't play aren't ranked");
  await shot(guest, "leaderboard");
  await guest.page.click("#tab-best");
  await guest.page.waitForSelector("#tab-best[aria-selected=true]");
});

// ---------- Admin ----------

// Making someone admin is a SQL step (README step 9); here it runs on the dev database.
function makeAdmin(email) {
  const dir = process.env.GEOBARKR_DEV_DIR;
  const sql = `update public.profiles set role = 'admin' where id = (select id from auth.users where email = '${email}')`;
  const args = ["-h", dir, "-p", "54329", "-U", "postgres", "-d", "postgres", "-c", sql];
  if (process.getuid?.() === 0) execFileSync("su", ["postgres", "-c", ["psql", ...args.map((a) => `'${a.replace(/'/g, "'\\''")}'`)].join(" ")]);
  else execFileSync("psql", args);
}

await step("admin: add a map and a location from a Street View link, see games", async () => {
  assert.ok(process.env.GEOBARKR_DEV_DIR, "set GEOBARKR_DEV_DIR to the dev stack's folder");
  const admin = await newPlayer("admin", DESKTOP);
  await signUp(admin, "Ada Admin");
  makeAdmin(admin.email);
  await admin.page.goto(`${BASE}/geobarkr/admin/`);
  await admin.page.waitForSelector("#admin:not([hidden])");
  assert.ok(await admin.page.locator(".gb-menu a[href='/geobarkr/admin/']").count(), "admin link in the menu");
  await admin.page.waitForSelector("#games a.gb-line");
  await admin.page.fill("#new-map input[name=name]", "Test Map");
  await admin.page.click("#new-map button");
  await admin.page.waitForSelector("#editor-section:not([hidden])");
  await admin.page.fill("#paste", "https://www.google.com/maps/@48.8583701,2.2944813,3a,75y,250.5h,95.2t/data=!3m6");
  assert.equal(await admin.page.inputValue("#editor input[name=lat]"), "48.85837");
  assert.equal(await admin.page.inputValue("#editor input[name=heading]"), "250.5");
  await admin.page.fill("#editor input[name=name]", "Eiffel Tower again");
  await admin.page.click("#save-location");
  await admin.page.waitForFunction(() => document.querySelector("#locations")?.textContent.includes("Eiffel Tower again"));
  await admin.page.screenshot({ path: path.join(OUT, "admin-desktop.png"), fullPage: true });
  // New maps start hidden from players until made active.
  await solo.page.goto(`${BASE}/geobarkr/`);
  await solo.page.waitForSelector("#map-select option[value]:not([value=''])", { state: "attached" });
  assert.ok(!(await solo.page.textContent("#map-select")).includes("Test Map"));
  await admin.context.close();
});

await browser.close();

const failed = results.filter((r) => !r.ok);
if (errors.length) console.log(`\nBrowser errors:\n${[...new Set(errors)].join("\n")}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${OUT}`);
process.exit(failed.length || errors.length ? 1 : 0);
