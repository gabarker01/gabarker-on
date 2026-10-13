// Demo mode: GeoBarkr without a Supabase project. The same rules as the
// database functions (geobarkr/supabase/migrations/002_functions.sql), kept in
// this browser's storage, with bot players so online and party games can be
// tried on one device. Nothing leaves the device; nobody else can join.
import { haversineKm, roundDistance, scoreForDistance } from "./geo.js?v=14";

const DB_KEY = "geobarkr-demo-v1";
const ME_KEY = "geobarkr-demo-me";
const CHANGED = "geobarkr-demo-changed";

const MAPS = [
  { id: "eb30f2ba-939a-f610-0fa1-7bfdfaba1097", name: "GeoBarkr Demo", active: true },
  { id: "6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01", name: "World tour", active: true },
];
const LOCATIONS = [
  ["eb30f2ba-939a-f610-0fa1-7bfdfaba1097", "4 Medley Road", 1, 51.54713683719802, -0.1947690014365771, 120, 0],
  ["eb30f2ba-939a-f610-0fa1-7bfdfaba1097", "Calitii", 2, 51.5160261988762, -0.12549442205816058, 200, 0],
  ["eb30f2ba-939a-f610-0fa1-7bfdfaba1097", "Eiffel Tower", 3, 48.859, 2.296, 250, 0],
  ["eb30f2ba-939a-f610-0fa1-7bfdfaba1097", "Sydney harbour", 4, -33.8524678, 151.2105238, 0, 0],
  ["eb30f2ba-939a-f610-0fa1-7bfdfaba1097", "CopaCobana", 5, -22.9682017, -43.1797941, 244.26, 0],
  ["6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01", "Times Square, New York", 1, 40.758, -73.9855, 30, 0],
  ["6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01", "Shibuya, Tokyo", 2, 35.6595, 139.7005, 60, 0],
  ["6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01", "V&A Waterfront, Cape Town", 3, -33.9036, 18.4207, 200, 0],
  ["6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01", "Laugavegur, Reykjavík", 4, 64.1455, -21.93, 90, 0],
  ["6e0b6a1e-5f53-4a8e-9a39-7d2f3c1b9a01", "Avenida 9 de Julio, Buenos Aires", 5, -34.6037, -58.3816, 0, 0],
].map(([map_id, name, round_number, lat, lng, heading, pitch], i) => ({ id: `demo-loc-${i}`, map_id, name, round_number, lat, lng, heading, pitch }));

// The bots: they join lobbies a few seconds apart and guess 5–20 s into a round.
const BOTS = [
  { id: "bot-pip", display_name: "Pip (bot)", skill: 450 },
  { id: "bot-gina", display_name: "Gina (bot)", skill: 1100 },
  { id: "bot-quinn", display_name: "Quinn (bot)", skill: 2400 },
];

const now = () => Date.now();
const iso = (t = now()) => new Date(t).toISOString();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${now()}-${Math.random().toString(16).slice(2)}`);
const fail = (message) => { throw new Error(message); };

// ---------- Storage ----------

function read() {
  try {
    const db = JSON.parse(localStorage.getItem(DB_KEY));
    if (db && db.version === 1) return db;
  } catch { /* fall through to a fresh store */ }
  return {
    version: 1,
    profiles: Object.fromEntries(BOTS.map((bot) => [bot.id, { id: bot.id, display_name: bot.display_name, role: "player", avatar_url: null, is_bot: true }])),
    maps: MAPS.map((map) => ({ ...map, created_at: iso() })),
    locations: LOCATIONS,
    games: [], players: [], rounds: [], guesses: [],
  };
}

function write(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  window.dispatchEvent(new Event(CHANGED));
}

function change(fn) {
  const db = read();
  const result = fn(db);
  write(db);
  return result;
}

// Signed in only while this browser's demo store still has your profile.
function meId() {
  let id = null;
  try { id = JSON.parse(localStorage.getItem(ME_KEY))?.id || null; } catch { /* signed out */ }
  if (id && !read().profiles[id]) {
    localStorage.removeItem(ME_KEY);
    return null;
  }
  return id;
}

const cleanName = (name) => {
  const value = String(name ?? "").trim();
  if (value.length < 1 || value.length > 80) fail("Give the map a name (up to 80 characters)");
  return value;
};
const checkPlace = (lat, lng) => {
  if (!(Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180)) {
    fail("Latitude must be between -90 and 90, and longitude between -180 and 180");
  }
};

function requireMe() {
  return meId() || fail("Sign in to play");
}

// ---------- Sign in ----------

export async function getSession() {
  const id = meId();
  return id ? { user: { id }, demo: true } : null;
}

export async function getProfile() {
  const id = meId();
  return id ? read().profiles[id] || null : null;
}

export async function signInDemo(name) {
  const display = String(name || "").trim().slice(0, 40) || "Player";
  const id = uuid();
  change((db) => { db.profiles[id] = { id, display_name: display, role: "admin", avatar_url: null }; });
  localStorage.setItem(ME_KEY, JSON.stringify({ id }));
}

export async function signOut() {
  localStorage.removeItem(ME_KEY);
}

export async function renameMe(name) {
  const id = requireMe();
  const display = String(name ?? "").trim().slice(0, 40);
  if (!display) fail("Enter a name");
  change((db) => { (db.profiles[id] || fail("Sign in to play")).display_name = display; });
}

// ---------- Helpers ----------

const gameOf = (db, id) => db.games.find((g) => g.id === id);
const playersOf = (db, id) => db.players.filter((p) => p.game_id === id);
const roundsOf = (db, id) => db.rounds.filter((r) => r.game_id === id).sort((a, b) => a.round_number - b.round_number);
const currentRound = (db, id) => roundsOf(db, id).find((r) => r.status === "in_progress" || r.status === "results");
const isMember = (db, game, uid) => game.host_id === uid || playersOf(db, game.id).some((p) => p.user_id === uid);

function newCode(db) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (db.games.some((g) => g.code === code));
  return code;
}

// Move to Results and add the round's scores to the totals (as reveal_round).
function reveal(db, round) {
  if (round.status !== "in_progress") return false;
  round.status = "results";
  for (const guess of db.guesses.filter((g) => g.round_id === round.id)) {
    const player = db.players.find((p) => p.id === guess.player_id);
    player.total_score += guess.score;
    player.total_distance_km += guess.distance_km;
  }
  return true;
}

function addGuess(db, round, player, lat, lng, at = now()) {
  const target = round;
  const distance = roundDistance(haversineKm(lat, lng, target.lat, target.lng));
  const guess = {
    id: uuid(), round_id: round.id, player_id: player.id, lat, lng,
    distance_km: distance, score: scoreForDistance(distance),
    time_ms: Math.max(0, at - Date.parse(round.started_at)), created_at: iso(at),
  };
  db.guesses.push(guess);
  const all = playersOf(db, round.game_id).length;
  const done = db.guesses.filter((g) => g.round_id === round.id).length;
  return { guess, complete: done >= all && reveal(db, round) };
}

// A bot's guess: somewhere around the target, usually within its skill (km).
function botGuess(target, skill) {
  const km = -Math.log(1 - Math.random()) * skill;
  const bearing = Math.random() * 2 * Math.PI;
  const d = km / 6371;
  const lat1 = (target.lat * Math.PI) / 180;
  const lng1 = (target.lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  const lng = (((lng2 * 180) / Math.PI + 540) % 360) - 180;
  return { lat: Math.max(-85, Math.min(85, (lat2 * 180) / Math.PI)), lng };
}

// Let the bots catch up with the clock: join lobbies, then guess.
function tick(db, gameId) {
  const game = gameOf(db, gameId);
  if (!game || !game.bots) return false;
  let changed = false;
  if (game.status === "lobby") {
    for (const plan of game.bots) {
      if (!plan.joined && now() >= plan.join_at) {
        db.players.push({ id: uuid(), game_id: game.id, user_id: plan.id, joined_at: iso(plan.join_at), total_score: 0, total_distance_km: 0 });
        plan.joined = true;
        changed = true;
      }
    }
  }
  const round = currentRound(db, gameId);
  if (game.status === "in_play" && round?.status === "in_progress") {
    const started = Date.parse(round.started_at);
    for (const plan of game.bots) {
      const player = db.players.find((p) => p.game_id === game.id && p.user_id === plan.id);
      if (!player || db.guesses.some((g) => g.round_id === round.id && g.player_id === player.id)) continue;
      const due = started + plan.delays[(round.round_number - 1) % plan.delays.length];
      if (now() >= due && round.status === "in_progress") {
        const bot = BOTS.find((b) => b.id === plan.id);
        const spot = botGuess(round, bot.skill);
        addGuess(db, round, player, spot.lat, spot.lng, due);
        changed = true;
      }
    }
  }
  return changed;
}

function withTick(gameId) {
  const db = read();
  if (tick(db, gameId)) write(db);
  return db;
}

// ---------- Game actions (same names and rules as the database functions) ----------

export async function createGame(type, mapId) {
  const uid = requireMe();
  return change((db) => {
    const map = db.maps.map(mapOf).find((m) => m.id === mapId && m.active && !m.blocked && (!m.owner_id || m.is_public || m.owner_id === uid))
      || fail("That map isn't available");
    const locations = db.locations.filter((l) => l.map_id === mapId).sort((a, b) => a.round_number - b.round_number);
    if (!locations.length) fail("That map has no locations yet");
    if (map.owner_id && locations.length !== 5) fail("That map needs all five locations first");
    const id = uuid();
    const solo = type === "single_player";
    const game = { id, code: newCode(db), type, status: solo ? "in_play" : "lobby", map_id: mapId, map_name: map.name, host_id: uid, created_at: iso(), started_at: solo ? iso() : null, completed_at: null };
    if (!solo) {
      const count = type === "local_multiplayer" ? 3 : 2;
      game.bots = BOTS.slice(0, count).map((bot, i) => ({
        id: bot.id, join_at: now() + 2000 + i * 1800, joined: false,
        delays: Array.from({ length: 5 }, () => 5000 + Math.round(Math.random() * 15000)),
      }));
    }
    db.games.push(game);
    locations.forEach((l, i) => db.rounds.push({
      id: uuid(), game_id: id, round_number: i + 1, location_id: l.id, location_name: l.name,
      lat: l.lat, lng: l.lng, heading: l.heading, pitch: l.pitch, photo_path: map.kind === "photo" ? l.photo_path : null,
      status: solo && i === 0 ? "in_progress" : "ready", started_at: solo && i === 0 ? iso() : null, ended_at: null,
    }));
    if (type !== "local_multiplayer") db.players.push({ id: uuid(), game_id: id, user_id: uid, joined_at: iso(), total_score: 0, total_distance_km: 0 });
    return { id, code: game.code, type };
  });
}

export async function joinGame(code) {
  const uid = requireMe();
  return change((db) => {
    const game = db.games.find((g) => g.code === String(code).trim().toUpperCase());
    if (!game || game.type === "single_player") fail("No game with that code. In demo mode, games only exist on this device");
    if (isMember(db, game, uid)) return { id: game.id, type: game.type, status: game.status };
    if (game.status === "cancelled") fail("That game was cancelled");
    if (game.status !== "lobby") fail("That game has already started");
    db.players.push({ id: uuid(), game_id: game.id, user_id: uid, joined_at: iso(), total_score: 0, total_distance_km: 0 });
    return { id: game.id, type: game.type, status: game.status };
  });
}

export async function cancelGame(gameId) {
  const uid = requireMe();
  change((db) => {
    const game = gameOf(db, gameId);
    if (!game || game.host_id !== uid) fail("Only the host can cancel the game");
    if (game.status !== "lobby") fail("The game has already started");
    game.status = "cancelled";
  });
}

export async function startGame(gameId) {
  const uid = requireMe();
  change((db) => {
    tick(db, gameId);
    const game = gameOf(db, gameId);
    if (!game || game.host_id !== uid) fail("Only the host can start the game");
    if (game.status !== "lobby") fail("The game has already started");
    if (playersOf(db, gameId).length < 2) fail("You need at least two players to start");
    game.status = "in_play";
    game.started_at = iso();
    const first = roundsOf(db, gameId)[0];
    first.status = "in_progress";
    first.started_at = iso();
  });
}

export async function submitGuess(gameId, lat, lng) {
  const uid = requireMe();
  return change((db) => {
    tick(db, gameId);
    const player = playersOf(db, gameId).find((p) => p.user_id === uid) || fail("You're not in this game");
    const game = gameOf(db, gameId);
    const round = roundsOf(db, gameId).find((r) => r.status === "in_progress");
    if (!round || game.status !== "in_play") fail("This round has finished");
    if (db.guesses.some((g) => g.round_id === round.id && g.player_id === player.id)) fail("You've already guessed this round");
    checkPlace(lat, lng);
    const { guess, complete } = addGuess(db, round, player, lat, lng);
    return { distance_km: guess.distance_km, score: guess.score, time_ms: guess.time_ms, round_complete: complete };
  });
}

export async function endRound(gameId) {
  const uid = requireMe();
  change((db) => {
    const game = gameOf(db, gameId);
    if (!game || game.host_id !== uid || game.type === "single_player") fail("Only the host can end the round");
    const round = roundsOf(db, gameId).find((r) => r.status === "in_progress");
    if (round) reveal(db, round);
  });
}

export async function nextRound(gameId) {
  const uid = requireMe();
  return change((db) => {
    const game = gameOf(db, gameId);
    if (!game || game.host_id !== uid) fail("Only the host can move to the next round");
    if (game.status !== "in_play") fail("This game isn't being played");
    const round = currentRound(db, gameId);
    if (round?.status === "in_progress") fail("Wait for everyone to guess, or end the round");
    if (round) {
      round.status = "complete";
      round.ended_at = iso();
      const next = roundsOf(db, gameId).find((r) => r.round_number === round.round_number + 1 && r.status === "ready");
      if (next) {
        next.status = "in_progress";
        next.started_at = iso();
        return "next";
      }
    }
    game.status = "complete";
    game.completed_at = iso();
    for (const r of roundsOf(db, gameId)) if (r.status !== "complete") { r.status = "complete"; r.ended_at ||= iso(); }
    return "complete";
  });
}

// ---------- Reading ----------

const profileOf = (db, id) => db.profiles[id] || { display_name: "Player", avatar_url: null };

export async function getGameState(gameId) {
  const uid = requireMe();
  const db = withTick(gameId);
  const game = gameOf(db, gameId);
  if (!game || !isMember(db, game, uid)) fail("Game not found");
  const isHost = game.host_id === uid;
  const round = currentRound(db, gameId);
  const reveal = round?.status === "results";
  const showTarget = reveal || (round?.status === "in_progress" && (game.type !== "local_multiplayer" || isHost));
  const players = playersOf(db, gameId).sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  return {
    game: {
      id: game.id, code: game.code, type: game.type, status: game.status, map_name: game.map_name, created_at: game.created_at,
      host_id: game.host_id, host_name: profileOf(db, game.host_id).display_name, is_host: isHost, round_count: roundsOf(db, gameId).length,
    },
    me: { user_id: uid, display_name: profileOf(db, uid).display_name, avatar_url: profileOf(db, uid).avatar_url, is_player: players.some((p) => p.user_id === uid) },
    players: players.map((p) => ({
      user_id: p.user_id, name: profileOf(db, p.user_id).display_name, avatar_url: profileOf(db, p.user_id).avatar_url,
      joined_at: p.joined_at, total_score: p.total_score, total_distance_km: p.total_distance_km, is_host: p.user_id === game.host_id,
    })),
    round: round ? {
      number: round.round_number, status: round.status, started_at: round.started_at,
      target: !showTarget ? null
        : round.photo_path && !reveal ? { photo_path: round.photo_path }
          : { lat: round.lat, lng: round.lng, heading: round.heading, pitch: round.pitch, photo_path: round.photo_path || null },
      place: reveal ? round.location_name : null,
    } : null,
    guesses: round ? db.guesses.filter((g) => g.round_id === round.id).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((g) => {
      const player = db.players.find((p) => p.id === g.player_id);
      const base = { user_id: player.user_id, name: profileOf(db, player.user_id).display_name, time_ms: g.time_ms };
      return reveal || player.user_id === uid ? { ...base, lat: g.lat, lng: g.lng, distance_km: g.distance_km, score: g.score } : base;
    }) : [],
  };
}

export async function getResults(gameId) {
  const uid = requireMe();
  const db = read();
  const game = gameOf(db, gameId);
  if (!game || !isMember(db, game, uid)) fail("Game not found");
  const finished = roundsOf(db, gameId).filter((r) => r.status === "results" || r.status === "complete");
  const players = playersOf(db, gameId).map((p) => {
    const guesses = finished.map((r) => {
      const g = db.guesses.find((x) => x.round_id === r.id && x.player_id === p.id);
      return g && { round: r.round_number, lat: g.lat, lng: g.lng, distance_km: g.distance_km, score: g.score, time_ms: g.time_ms };
    }).filter(Boolean);
    return {
      user_id: p.user_id, name: profileOf(db, p.user_id).display_name, avatar_url: profileOf(db, p.user_id).avatar_url, joined_at: p.joined_at,
      is_me: p.user_id === uid, total_score: p.total_score, total_distance_km: p.total_distance_km,
      total_time_ms: db.guesses.filter((g) => g.player_id === p.id).reduce((sum, g) => sum + g.time_ms, 0), guesses,
    };
  }).sort((a, b) => b.total_score - a.total_score || a.joined_at.localeCompare(b.joined_at));
  return {
    game: { id: game.id, code: game.code, type: game.type, status: game.status, map_name: game.map_name, created_at: game.created_at, is_host: game.host_id === uid },
    rounds: finished.map((r) => ({ number: r.round_number, lat: r.lat, lng: r.lng, name: r.location_name, photo_path: r.photo_path || null })),
    players,
  };
}

export async function myGames() {
  const uid = requireMe();
  const db = read();
  return db.games
    .map((g) => {
      const me = playersOf(db, g.id).find((p) => p.user_id === uid);
      if ((g.host_id !== uid && !me) || g.status === "cancelled") return null;
      const all = playersOf(db, g.id);
      return {
        id: g.id, code: g.code, type: g.type, status: g.status, map_name: g.map_name, created_at: g.created_at,
        is_host: g.host_id === uid, my_score: me ? me.total_score : null, player_count: all.length,
        my_rank: me ? 1 + all.filter((o) => o.total_score > me.total_score).length : null,
        places: roundsOf(db, g.id).filter((r) => r.status === "results" || r.status === "complete").map((r) => {
          const mine = me && db.guesses.find((x) => x.round_id === r.id && x.player_id === me.id);
          return { lat: r.lat, lng: r.lng, guess_lat: mine?.lat ?? null, guess_lng: mine?.lng ?? null };
        }),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function leaderboard(sort = "total") {
  const uid = requireMe();
  const db = read();
  const done = new Set(db.games.filter((g) => g.status === "complete").map((g) => g.id));
  const by = new Map();
  for (const p of db.players.filter((x) => done.has(x.game_id))) {
    const row = by.get(p.user_id) || { user_id: p.user_id, games: 0, total_score: 0, best_game: 0 };
    row.games += 1;
    row.total_score += p.total_score;
    row.best_game = Math.max(row.best_game, p.total_score);
    by.set(p.user_id, row);
  }
  const key = sort === "best" ? "best_game" : "total_score";
  return [...by.values()]
    .sort((a, b) => b[key] - a[key] || b.games - a.games)
    .slice(0, 100)
    .map((row, i) => ({
      rank: i + 1, name: profileOf(db, row.user_id).display_name, avatar_url: profileOf(db, row.user_id).avatar_url,
      is_me: row.user_id === uid, games: row.games, total_score: row.total_score, best_game: row.best_game,
      average_game: Math.round(row.total_score / row.games),
    }));
}

// ---------- Maps (in demo mode you're the admin) ----------

// Maps saved before players could make them have none of these.
const mapOf = (m) => ({ description: "", kind: "street_view", is_public: true, owner_id: null, blocked: false, ...m });
const roundsOn = (db, mapId) => db.locations.filter((l) => l.map_id === mapId).length;

export async function playableMaps() {
  const uid = requireMe();
  const db = read();
  return db.maps.map(mapOf)
    .filter((m) => m.active && !m.blocked && (!m.owner_id || m.is_public || m.owner_id === uid))
    .map((m) => ({ ...m, rounds: roundsOn(db, m.id) }))
    .filter((m) => (m.owner_id ? m.rounds === 5 : m.rounds >= 1))
    .map((m) => ({
      id: m.id, name: m.name, description: m.description, kind: m.kind, is_public: m.is_public,
      mine: m.owner_id === uid, owner_name: m.owner_id ? profileOf(db, m.owner_id).display_name : null, rounds: m.rounds,
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
export async function adminMaps() {
  const db = read();
  return db.maps.map(mapOf).map(({ id, name, active, kind, is_public, owner_id, blocked }) => ({
    id, name, active, kind, is_public, owner_id, blocked, owner_name: owner_id ? profileOf(db, owner_id).display_name : null,
  })).sort((a, b) => a.name.localeCompare(b.name));
}
export async function saveMap(map) {
  return change((db) => {
    if (map.id) {
      const found = db.maps.find((m) => m.id === map.id) || fail("That map has been deleted");
      Object.assign(found, { name: cleanName(map.name ?? found.name), active: map.active ?? found.active, ...(map.blocked != null && { blocked: map.blocked }) });
      return null;
    }
    const created = { id: uuid(), name: cleanName(map.name), active: map.active ?? false, created_at: iso() };
    db.maps.push(created);
    return { id: created.id, name: created.name, active: created.active };
  });
}
export async function deleteMap(id) {
  const removed = change((db) => {
    const paths = db.locations.filter((l) => l.map_id === id && l.photo_path).map((l) => l.photo_path);
    db.maps = db.maps.filter((m) => m.id !== id);
    db.locations = db.locations.filter((l) => l.map_id !== id);
    for (const g of db.games) if (g.map_id === id) g.map_id = null;
    return paths.filter((p) => photoUnused(db, p));
  });
  forgetPhotos(removed);
}
export async function mapLocations(mapId) {
  return read().locations.filter((l) => l.map_id === mapId).sort((a, b) => a.round_number - b.round_number);
}
export async function saveLocation(location) {
  change((db) => {
    const clash = db.locations.find((l) => l.map_id === (location.map_id || db.locations.find((x) => x.id === location.id)?.map_id)
      && l.round_number === location.round_number && l.id !== location.id);
    if (clash) fail(`Round ${location.round_number} already has a location on this map`);
    if (location.lat != null || location.lng != null) checkPlace(location.lat, location.lng);
    if (location.id) Object.assign(db.locations.find((l) => l.id === location.id) || fail("That location has been deleted"), location);
    else db.locations.push({ ...location, id: uuid() });
  });
}
export async function deleteLocation(id) {
  change((db) => { db.locations = db.locations.filter((l) => l.id !== id); });
}
export async function recentGames() {
  const db = read();
  return [...db.games].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50)
    .map((g) => ({ ...g, host_name: profileOf(db, g.host_id).display_name }));
}

// ---------- Your maps (same rules as the database functions) ----------

const ownMap = (db, mapId, uid) => db.maps.map(mapOf).find((m) => m.id === mapId && m.owner_id === uid) || fail("Map not found");
const rawMap = (db, mapId) => db.maps.find((m) => m.id === mapId);
function checkDetails(name, description) {
  const clean = String(name ?? "").trim();
  if (clean.length < 1 || clean.length > 80) fail("Give the map a name (up to 80 characters)");
  if (String(description ?? "").trim().length > 140) fail("Keep the description to 140 characters");
  return clean;
}
// A photo no location or game uses any more can go.
const photoUnused = (db, path) => Boolean(path) && !db.locations.some((l) => l.photo_path === path) && !db.rounds.some((r) => r.photo_path === path);
const plays = (db, mapId) => db.games.filter((g) => g.map_id === mapId && g.status === "complete").length;

export async function myMaps() {
  const uid = requireMe();
  const db = read();
  return db.maps.map(mapOf).filter((m) => m.owner_id === uid)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((m) => {
      const locations = db.locations.filter((l) => l.map_id === m.id).sort((a, b) => a.round_number - b.round_number);
      return {
        id: m.id, name: m.name, description: m.description, kind: m.kind, is_public: m.is_public, active: m.active, blocked: m.blocked, created_at: m.created_at,
        rounds: locations.length, cover_path: locations.find((l) => l.photo_path)?.photo_path || null,
        places: locations.map((l) => ({ lat: l.lat, lng: l.lng })), plays: plays(db, m.id),
      };
    });
}

export async function getMyMap(mapId) {
  const uid = requireMe();
  const db = read();
  const m = ownMap(db, mapId, uid);
  return {
    id: m.id, name: m.name, description: m.description, kind: m.kind, is_public: m.is_public, active: m.active, blocked: m.blocked,
    created_at: m.created_at, plays: plays(db, m.id),
    locations: db.locations.filter((l) => l.map_id === m.id).sort((a, b) => a.round_number - b.round_number)
      .map(({ round_number, name, lat, lng, heading, pitch, photo_path }) => ({ round_number, name, lat, lng, heading, pitch, photo_path: photo_path || null })),
  };
}

export async function createMyMap({ name, description = "", kind, isPublic = true }) {
  const uid = requireMe();
  return change((db) => {
    const clean = checkDetails(name, description);
    if (!["street_view", "photo"].includes(kind)) fail("Choose Street View or photos");
    if (db.maps.filter((m) => m.owner_id === uid).length >= 30) fail("You can have up to 30 maps. Delete one to make another");
    const id = uuid();
    db.maps.push({ id, name: clean, description: String(description).trim(), kind, is_public: isPublic !== false, active: true, owner_id: uid, created_at: iso() });
    return id;
  });
}

export async function updateMyMap(mapId, { name, description = "", isPublic, active }) {
  const uid = requireMe();
  change((db) => {
    ownMap(db, mapId, uid);
    const clean = checkDetails(name, description);
    Object.assign(rawMap(db, mapId), {
      name: clean, description: String(description).trim(),
      ...(isPublic != null && { is_public: Boolean(isPublic) }), ...(active != null && { active: Boolean(active) }),
    });
  });
}

export async function saveMyLocation(mapId, round, location) {
  const uid = requireMe();
  const removed = change((db) => {
    const map = ownMap(db, mapId, uid);
    if (!(round >= 1 && round <= 5)) fail("Maps have five rounds");
    const name = String(location.name ?? "").trim();
    if (name.length < 1 || name.length > 80) fail("Give the place a name (up to 80 characters)");
    checkPlace(location.lat, location.lng);
    if (map.kind === "photo" && !location.photo_path) fail("Add a photo for this round");
    if (map.kind !== "photo" && location.photo_path) fail("Street View maps don't have photos");
    const row = {
      map_id: mapId, round_number: round, name, lat: location.lat, lng: location.lng,
      heading: (((Number(location.heading) || 0) % 360) + 360) % 360, pitch: Math.max(-90, Math.min(90, Number(location.pitch) || 0)),
      photo_path: location.photo_path || null,
    };
    const existing = db.locations.find((l) => l.map_id === mapId && l.round_number === round);
    const old = existing?.photo_path;
    if (existing) Object.assign(existing, row);
    else db.locations.push({ id: uuid(), ...row });
    return old !== row.photo_path && photoUnused(db, old) ? old : null;
  });
  forgetPhotos([removed]);
}

export async function deleteMyLocation(mapId, round) {
  const uid = requireMe();
  const removed = change((db) => {
    ownMap(db, mapId, uid);
    const old = db.locations.find((l) => l.map_id === mapId && l.round_number === round)?.photo_path;
    db.locations = db.locations.filter((l) => !(l.map_id === mapId && l.round_number === round));
    return photoUnused(db, old) ? old : null;
  });
  forgetPhotos([removed]);
}

export async function deleteMyMap(mapId) {
  const uid = requireMe();
  const removed = change((db) => {
    ownMap(db, mapId, uid);
    const paths = db.locations.filter((l) => l.map_id === mapId && l.photo_path).map((l) => l.photo_path);
    db.maps = db.maps.filter((m) => m.id !== mapId);
    db.locations = db.locations.filter((l) => l.map_id !== mapId);
    for (const g of db.games) if (g.map_id === mapId) g.map_id = null;
    return paths.filter((p) => photoUnused(db, p));
  });
  forgetPhotos(removed);
}

// Demo photos stay on this device, smaller, each under its own storage key.
const PHOTO_KEY = "geobarkr-demo-photo:";
export const PHOTO_SIZE = { maxSide: 1280, quality: 0.72 };
export const photoUrl = (path) => {
  if (!path) return null;
  try { return localStorage.getItem(PHOTO_KEY + path); } catch { return null; }
};
export async function uploadPhoto(blob) {
  const uid = requireMe();
  const path = `${uid}/${uuid().replace(/[^A-Za-z0-9_-]/g, "")}.jpg`;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Couldn't read the photo"));
    reader.readAsDataURL(blob);
  });
  try {
    localStorage.setItem(PHOTO_KEY + path, dataUrl);
  } catch {
    fail("This device has no room for more demo photos. Delete a demo map first");
  }
  return path;
}
function forgetPhotos(paths) {
  for (const path of paths) if (path) localStorage.removeItem(PHOTO_KEY + path);
}
export async function discardPhoto(path) { forgetPhotos([path]); }

// ---------- Your numbers, for your profile (as my_stats) ----------

export async function myStats() {
  const uid = requireMe();
  const db = read();
  const done = new Set(db.games.filter((g) => g.status === "complete").map((g) => g.id));
  const mine = db.players.filter((p) => p.user_id === uid && done.has(p.game_id)).map((p) => {
    const others = playersOf(db, p.game_id);
    return { ...p, type: gameOf(db, p.game_id).type, players: others.length, place: 1 + others.filter((o) => o.total_score > p.total_score).length };
  });
  const ids = new Set(mine.map((p) => p.id));
  const guesses = db.guesses.filter((g) => ids.has(g.player_id))
    .map((g) => ({ ...g, place: db.rounds.find((r) => r.id === g.round_id)?.location_name }));
  const totals = new Map();
  for (const p of db.players.filter((x) => done.has(x.game_id))) totals.set(p.user_id, (totals.get(p.user_id) || 0) + p.total_score);
  const sum = (list, key) => list.reduce((total, item) => total + item[key], 0);
  const avg = (list, key) => (list.length ? sum(list, key) / list.length : null);
  const closest = [...guesses].sort((a, b) => a.distance_km - b.distance_km || a.time_ms - b.time_ms)[0];
  const total = sum(mine, "total_score");
  return {
    games: mine.length,
    solo_games: mine.filter((p) => p.type === "single_player").length,
    group_games: mine.filter((p) => p.type !== "single_player").length,
    wins: mine.filter((p) => p.players > 1 && p.place === 1).length,
    total_score: total,
    best_game: Math.max(0, ...mine.map((p) => p.total_score)),
    average_game: mine.length ? Math.round(avg(mine, "total_score")) : null,
    rounds: guesses.length,
    perfect_rounds: guesses.filter((g) => g.score === 5000).length,
    average_km: avg(guesses, "distance_km"),
    closest_km: closest?.distance_km ?? null,
    closest_place: closest?.place ?? null,
    average_time_ms: guesses.length ? Math.round(avg(guesses, "time_ms")) : null,
    fastest_ms: guesses.length ? Math.min(...guesses.map((g) => g.time_ms)) : null,
    rank: mine.length ? 1 + [...totals.values()].filter((t) => t > total).length : null,
    players: totals.size,
    maps_made: db.maps.filter((m) => m.owner_id === uid).length,
  };
}

// ---------- Live updates: changes in this tab or another tab of this browser ----------

export function subscribe(gameId, onEvent) {
  const same = () => onEvent("demo");
  const other = (event) => { if (event.key === DB_KEY) onEvent("demo"); };
  window.addEventListener(CHANGED, same);
  window.addEventListener("storage", other);
  return () => {
    window.removeEventListener(CHANGED, same);
    window.removeEventListener("storage", other);
  };
}

export async function resetDemo() {
  for (const key of Object.keys(localStorage)) if (key.startsWith(PHOTO_KEY)) localStorage.removeItem(key);
  localStorage.removeItem(DB_KEY);
  localStorage.removeItem(ME_KEY);
  window.dispatchEvent(new Event(CHANGED));
}
