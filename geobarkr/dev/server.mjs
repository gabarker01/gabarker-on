// A local stand-in for Supabase, for testing GeoBarkr without the real
// project. Not used by the live site.
//
//   http://localhost:8080   the site (repo root), with a dev config.js
//   http://localhost:54321  Supabase-like API on a local Postgres running
//                           GeoBarkr's real SQL:
//                             /auth/v1     email + password accounts (JWTs)
//                             /rest/v1     tables and rpc, as PostgREST, with
//                                          the caller's role and RLS applied
//                             /realtime/v1 Phoenix websocket; private
//                                          broadcast channels fed from
//                                          realtime.messages
//
// Usage: geobarkr/dev/start.sh (sets up Postgres, then runs this).
// Needs the npm packages pg and ws (start.sh installs them outside the repo).
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// pg and ws are installed outside the repo by start.sh (GEOBARKR_DEPS).
const require = createRequire(path.join(process.env.GEOBARKR_DEPS || process.cwd(), "noop.js"));
const pg = require("pg");
const { WebSocketServer } = require("ws");

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const SITE_PORT = Number(process.env.SITE_PORT || 8080);
const API_PORT = Number(process.env.API_PORT || 54321);
const SECRET = "geobarkr-local-dev-secret";
const API_URL = `http://localhost:${API_PORT}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// ---------- JWTs ----------

const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
function sign(claims) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(claims);
  const sig = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  const [head, body, sig] = String(token || "").split(".");
  if (!sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  if (expected !== sig) return null;
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}
const ANON_KEY = sign({ role: "anon", iss: "geobarkr-dev" });

// ---------- Database as a role ----------

async function asRole(claims, run) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${claims?.role === "authenticated" ? "authenticated" : "anon"}`);
    await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)",
      [JSON.stringify(claims || { role: "anon" }), claims?.sub || ""]);
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------- Auth ----------

const users = new Map(); // email → { id, password hash, metadata }
const refreshTokens = new Map(); // token → user id

function hash(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString("hex");
}

function userJson(user) {
  return {
    id: user.id, aud: "authenticated", role: "authenticated", email: user.email,
    user_metadata: user.metadata, app_metadata: { provider: "email", providers: ["email"] },
    created_at: user.created_at, updated_at: user.created_at,
    email_confirmed_at: user.created_at, confirmed_at: user.created_at, identities: [],
  };
}

function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = sign({
    sub: user.id, role: "authenticated", aud: "authenticated", email: user.email,
    iat: now, exp: now + 3600, user_metadata: user.metadata,
  });
  const refresh = crypto.randomBytes(16).toString("hex");
  refreshTokens.set(refresh, user.id);
  return { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(user) };
}

async function auth(req, res, url, body) {
  const route = url.pathname.replace("/auth/v1", "");
  if (route === "/signup" && req.method === "POST") {
    const email = String(body.email || "").toLowerCase();
    if (!email || String(body.password || "").length < 6) return send(res, 422, { code: 422, msg: "Password should be at least 6 characters.", message: "Password should be at least 6 characters." });
    if (users.has(email)) return send(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered", message: "User already registered" });
    const salt = crypto.randomBytes(8).toString("hex");
    const user = { id: crypto.randomUUID(), email, salt, hash: hash(body.password, salt), metadata: body.data || {}, created_at: new Date().toISOString() };
    await pool.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [user.id, email, user.metadata]);
    users.set(email, user);
    return send(res, 200, session(user));
  }
  if (route === "/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    let user = null;
    if (grant === "password") {
      const found = users.get(String(body.email || "").toLowerCase());
      if (found && hash(String(body.password || ""), found.salt) === found.hash) user = found;
    } else if (grant === "refresh_token") {
      const id = refreshTokens.get(body.refresh_token);
      user = [...users.values()].find((u) => u.id === id) || null;
    }
    if (!user) return send(res, 400, { code: 400, error: "invalid_grant", error_code: "invalid_credentials", error_description: "Invalid login credentials", msg: "Invalid login credentials", message: "Invalid login credentials" });
    return send(res, 200, session(user));
  }
  if (route === "/user") {
    const claims = verify((req.headers.authorization || "").replace(/^Bearer /i, ""));
    const user = claims && [...users.values()].find((u) => u.id === claims.sub);
    if (!user) return send(res, 401, { code: 401, msg: "Invalid token", message: "Invalid token" });
    return send(res, 200, userJson(user));
  }
  if (route === "/logout") return send(res, 204);
  if (route === "/settings") return send(res, 200, { external: { email: true, google: false }, disable_signup: false, mailer_autoconfirm: true });
  return send(res, 404, { message: `No dev auth route ${route}` });
}

// ---------- REST (a small PostgREST) ----------

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (name) => {
  if (!IDENT.test(name)) throw Object.assign(new Error(`Bad identifier ${name}`), { status: 400 });
  return `"${name}"`;
};

function filters(params, values) {
  const where = [];
  for (const [key, raw] of params) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(key)) continue;
    const [op, ...rest] = raw.split(".");
    const value = rest.join(".");
    if (op === "eq") { values.push(value); where.push(`${ident(key)} = $${values.length}`); }
    else if (op === "neq") { values.push(value); where.push(`${ident(key)} <> $${values.length}`); }
    else if (op === "in") {
      const items = value.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
      values.push(items);
      where.push(`${ident(key)}::text = any($${values.length})`);
    } else if (op === "is") { where.push(`${ident(key)} is ${value === "null" ? "null" : value === "true" ? "true" : "false"}`); }
    else throw Object.assign(new Error(`Unsupported filter ${op}`), { status: 400 });
  }
  return where.length ? ` where ${where.join(" and ")}` : "";
}

function selectList(select) {
  if (!select || select === "*") return "*";
  return select.split(",").map((c) => ident(c.trim())).join(", ");
}

async function rest(req, res, url, body, claims) {
  const parts = url.pathname.replace("/rest/v1/", "").split("/");
  const params = [...url.searchParams.entries()];
  const values = [];
  const wantsObject = (req.headers.accept || "").includes("vnd.pgrst.object");
  const returnRows = (req.headers.prefer || "").includes("return=representation");

  if (parts[0] === "rpc") {
    const fn = ident(parts[1]);
    const args = Object.entries(body || {});
    const sql = `select public.${fn}(${args.map(([k], i) => `${ident(k)} => $${i + 1}`).join(", ")}) as result`;
    const result = await asRole(claims, (c) => c.query(sql, args.map(([, v]) => (v == null ? null : typeof v === "object" ? JSON.stringify(v) : String(v)))));
    return send(res, 200, result.rows[0].result ?? null);
  }

  const table = `public.${ident(parts[0])}`;
  const select = url.searchParams.get("select");
  let sql;
  if (req.method === "GET") {
    sql = `select ${selectList(select)} from ${table}${filters(params, values)}`;
    const order = url.searchParams.get("order");
    if (order) sql += ` order by ${order.split(",").map((o) => { const [col, dir] = o.split("."); return `${ident(col)} ${dir === "desc" ? "desc" : "asc"}`; }).join(", ")}`;
    if (url.searchParams.get("limit")) sql += ` limit ${Number(url.searchParams.get("limit"))}`;
  } else if (req.method === "POST") {
    const rows = Array.isArray(body) ? body : [body];
    const cols = Object.keys(rows[0]);
    const tuples = rows.map((row) => `(${cols.map((col) => { values.push(row[col]); return `$${values.length}`; }).join(", ")})`);
    sql = `insert into ${table} (${cols.map(ident).join(", ")}) values ${tuples.join(", ")}${returnRows ? ` returning ${selectList(select)}` : ""}`;
  } else if (req.method === "PATCH") {
    const sets = Object.entries(body).map(([col, value]) => { values.push(value); return `${ident(col)} = $${values.length}`; });
    sql = `update ${table} set ${sets.join(", ")}${filters(params, values)}${returnRows ? ` returning ${selectList(select)}` : ""}`;
  } else if (req.method === "DELETE") {
    sql = `delete from ${table}${filters(params, values)}${returnRows ? ` returning ${selectList(select)}` : ""}`;
  } else {
    return send(res, 405, { message: "Method not allowed" });
  }

  const result = await asRole(claims, (c) => c.query(sql, values));
  if (req.method !== "GET" && !returnRows) return send(res, 204);
  if (wantsObject) {
    if (result.rows.length !== 1) {
      return send(res, 406, { code: "PGRST116", details: `The result contains ${result.rows.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" });
    }
    return send(res, 200, result.rows[0]);
  }
  return send(res, req.method === "POST" ? 201 : 200, result.rows);
}

// ---------- HTTP ----------

function send(res, status, json) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Expose-Headers": "*",
  });
  res.end(json === undefined ? "" : JSON.stringify(json));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

const api = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  const url = new URL(req.url, API_URL);
  const body = await readBody(req);
  try {
    if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url, body);
    if (url.pathname.startsWith("/rest/v1/")) {
      const claims = verify((req.headers.authorization || "").replace(/^Bearer /i, ""));
      return await rest(req, res, url, body, claims?.role === "authenticated" ? claims : null);
    }
    return send(res, 404, { message: "Not found" });
  } catch (error) {
    const status = error.status || (error.code === "42501" ? 403 : 400);
    return send(res, status, { code: error.code || "PGRST000", message: error.message, details: error.detail || null, hint: error.hint || null });
  }
});

// ---------- Realtime (private broadcast channels) ----------

const sockets = new Set();
const wss = new WebSocketServer({ noServer: true });
api.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/realtime/v1/websocket")) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});

wss.on("connection", (ws) => {
  ws.channels = new Map(); // topic → { joinRef, claims }
  sockets.add(ws);
  ws.on("close", () => sockets.delete(ws));
  ws.on("message", async (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const [joinRef, ref, topic, event, payload] = message;
    const reply = (response, status = "ok") => ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status, response }]));
    if (event === "heartbeat") return reply({});
    if (event === "phx_leave") { ws.channels.delete(topic); return reply({}); }
    if (event === "access_token") {
      const channel = ws.channels.get(topic);
      if (channel) channel.claims = verify(payload.access_token);
      return;
    }
    if (event === "phx_join") {
      const claims = verify(payload.access_token);
      const gameTopic = topic.replace(/^realtime:/, "");
      let allowed = false;
      try {
        allowed = await asRole(claims, (c) => c.query("select public.can_listen($1) as ok", [gameTopic]).then((r) => r.rows[0].ok));
      } catch { allowed = false; }
      if (!allowed) return reply({ reason: "Unauthorized: you do not have permissions to read from this Channel topic" }, "error");
      ws.channels.set(topic, { joinRef, claims });
      reply({ postgres_changes: [] });
      ws.send(JSON.stringify([joinRef, null, topic, "system", { status: "ok", message: "Subscribed to PostgreSQL", extension: "system", channel: gameTopic }]));
    }
  });
});

let lastMessage = 0;
async function pumpMessages() {
  try {
    const { rows } = await pool.query("select id, topic, event, payload from realtime.messages where id > $1 order by id", [lastMessage]);
    for (const row of rows) {
      lastMessage = row.id;
      const topic = `realtime:${row.topic}`;
      for (const ws of sockets) {
        const channel = ws.channels.get(topic);
        if (channel) ws.send(JSON.stringify([channel.joinRef, null, topic, "broadcast", { type: "broadcast", event: row.event, payload: row.payload }]));
      }
    }
  } catch (error) {
    console.error("realtime pump", error.message);
  }
  setTimeout(pumpMessages, 200);
}

// ---------- The site ----------

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".mp3": "audio/mpeg", ".svg": "image/svg+xml", ".json": "application/json", ".geojson": "application/json" };

const DEMO = process.env.DEMO === "1";
const devConfig = `export const SUPABASE_URL = ${JSON.stringify(DEMO ? "" : API_URL)};
export const SUPABASE_KEY = ${JSON.stringify(DEMO ? "" : ANON_KEY)};
export const GOOGLE_MAPS_KEY = ${JSON.stringify(process.env.GOOGLE_MAPS_KEY ?? "dev")};
export const AUTH_PROVIDERS = ["email", "google"];
export const POLL_MS = ${Number(process.env.POLL_MS || 15000)};
`;

const site = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${SITE_PORT}`);
  if (url.pathname === "/geobarkr/js/config.js") {
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    return res.end(devConfig);
  }
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/html" });
    return res.end(fs.readFileSync(path.join(ROOT, "404.html")));
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
});

api.listen(API_PORT, () => console.log(`GeoBarkr dev API on ${API_URL}`));
site.listen(SITE_PORT, () => console.log(`GeoBarkr dev site on http://localhost:${SITE_PORT}/geobarkr/`));
pumpMessages();
