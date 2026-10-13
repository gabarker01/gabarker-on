// The start screen (ServiceNow: the "Start Game" record producer): the places
// you've played on a world map, a Resume strip for a game in progress, then
// choose how to play, pick a map and press Play, or join with a room code.
import { initPage, $, h, busy, showError, codeInput, closeButton, pageReady, param, toast, sheetDialog, kindIcon, KIND_NAMES } from "../ui.js?v=13";
import { playableMaps, createGame, joinGame, myGames, gamePageUrl } from "../api.js?v=13";
import { drawWorld } from "../worldmap.js?v=13";
import { ME_COLOUR } from "../players.js?v=13";
import { GAME_TYPES, formatScore } from "../geo.js?v=13";

// Held until the map, your places and the map list are in, so nothing pops in.
await initPage({ hold: true });

// ---------- Your places, and a game to resume ----------
const placesShown = (async () => {
  let games = [];
  try { games = await myGames(); } catch { /* the map still draws */ }
  const seen = new Map();
  for (const g of games) for (const p of g.places || []) seen.set(`${p.lat.toFixed(3)},${p.lng.toFixed(3)}`, p);
  const narrow = window.innerWidth < 900;
  await drawWorld($("#band"), {
    view: { lat: narrow ? 30 : 22, lng: narrow ? 0 : 10, zoom: narrow ? 0.55 : 0 },
    dots: [...seen.values()].map((p) => ({ lat: p.lat, lng: p.lng, colour: ME_COLOUR, r: 4.5, stroke: "#fff", strokeWidth: 2 })),
  });
  const finished = games.filter((g) => g.status === "complete" && g.my_score != null);
  if (seen.size) {
    const best = Math.max(0, ...finished.map((g) => g.my_score));
    $("#home-chip").replaceChildren(h("b", {}, `${seen.size} place${seen.size === 1 ? "" : "s"}`), best ? ` · best game ${formatScore(best)}` : "");
    $("#home-chip").hidden = false;
  }
  const current = games.find((g) => g.status === "in_play" || g.status === "lobby");
  if (current) {
    const resume = $("#resume");
    resume.href = gamePageUrl(current, { isHost: current.is_host, isPlayer: current.my_score != null });
    resume.replaceChildren(
      h("span", {}, h("span", { class: "k" }, current.status === "lobby" ? "Waiting in the lobby" : "Your game in progress"),
        h("b", {}, `${GAME_TYPES[current.type]} · ${current.map_name}`)),
      h("span", { class: "go" }, "Resume"));
    resume.hidden = false;
  }
})().catch(() => {});

// ---------- How to play, map, Play ----------
const NOTES = {
  single_player: "Five rounds on your own.",
  multiplayer: "Everyone plays on their own phone. You'll get a room code and a link to share.",
  local_multiplayer: "Street View on this screen for the room; everyone guesses on their phone.",
};
let mode = "single_player";
for (const button of document.querySelectorAll("#modes [data-type]")) {
  button.addEventListener("click", () => {
    mode = button.dataset.type;
    for (const b of document.querySelectorAll("#modes [data-type]")) b.setAttribute("aria-checked", String(b === button));
    $("#play-button").textContent = button.dataset.play;
    $("#mode-note").textContent = NOTES[mode];
  });
}

// ---------- Map: a searchable list, your last map first ----------
// Each map says whether it's Street View or photos, and who made it.
const LAST_MAP = "geobarkr-last-map";
const remembered = () => { try { return localStorage.getItem(LAST_MAP); } catch { return null; } };
let maps = [];
let mapId = null;
let kindFilter = "all";
const picker = $("#map-picker");
const closePicker = sheetDialog(picker);
$("#map-picker-close").replaceWith(closeButton(closePicker));

function chooseMap(id) {
  mapId = id;
  const map = maps.find((m) => m.id === id);
  $("#map-name").replaceChildren(...(map ? [kindIcon(map.kind), map.name] : ["Choose a map"]));
}

const byline = (m) => [
  m.mine ? "Your map" : m.owner_name ? `By ${m.owner_name}` : null,
  m.description || null,
].filter(Boolean).join(" · ");

function renderMaps() {
  const query = $("#map-search").value.trim().toLowerCase();
  const last = remembered();
  const shown = maps
    .filter((m) => kindFilter === "all" || (kindFilter === "mine" ? m.mine : m.kind === kindFilter))
    .filter((m) => !query || [m.name, m.description, m.owner_name, KIND_NAMES[m.kind]].some((t) => String(t || "").toLowerCase().includes(query)))
    .sort((a, b) => (b.id === last) - (a.id === last) || a.name.localeCompare(b.name));
  $("#map-list").replaceChildren(...shown.map((m, i) => h("button", {
    type: "button", role: "option", class: "gb-pick", "data-id": m.id, "data-name": m.name, "data-kind": m.kind, "aria-selected": String(m.id === mapId),
    style: `--i:${Math.min(i, 12)}`,
    onclick: (event) => {
      chooseMap(m.id);
      for (const b of $("#map-list").children) b.setAttribute("aria-selected", String(b === event.currentTarget));
      setTimeout(closePicker, 120); // let the tick show first
    },
  }, kindIcon(m.kind),
  h("span", { class: "name" }, h("b", {}, m.name), h("span", { class: "sub" }, [KIND_NAMES[m.kind], byline(m)].filter(Boolean).join(" · "))),
  m.id === last ? h("span", { class: "gb-tag" }, "Last played") : null,
  m.mine && !m.is_public ? h("span", { class: "gb-tag" }, "Private") : null,
  h("span", { class: "tick", "aria-hidden": "true" }, "✓"))));
  $("#map-empty").hidden = shown.length > 0;
}

$("#map-search").addEventListener("input", renderMaps);
for (const chip of document.querySelectorAll("#map-kinds button")) {
  chip.addEventListener("click", () => {
    kindFilter = chip.dataset.kind;
    for (const c of document.querySelectorAll("#map-kinds button")) c.setAttribute("aria-pressed", String(c === chip));
    renderMaps();
  });
}
$("#map-button").addEventListener("click", () => {
  $("#map-search").value = "";
  renderMaps();
  picker.showModal();
});

try {
  maps = await playableMaps();
  if (maps.length) {
    // ?map= (Play on a map you've made), else the map you played last.
    const wanted = param("map");
    const last = remembered();
    chooseMap(maps.some((m) => m.id === wanted) ? wanted : maps.some((m) => m.id === last) ? last : [...maps].sort((a, b) => a.name.localeCompare(b.name))[0].id);
    $("#map-kinds").hidden = !maps.some((m) => m.kind === "photo") && !maps.some((m) => m.mine);
    $("#map-chip-mine").hidden = !maps.some((m) => m.mine);
    $("#map-button").disabled = false;
    renderMaps();
  } else {
    $("#map-name").textContent = "No maps yet";
  }
} catch (error) {
  $("#map-name").textContent = "Couldn't load maps";
  showError(error);
}

await Promise.race([placesShown, new Promise((done) => setTimeout(done, 2500))]);
pageReady();
if (param("cancelled")) toast("That game was cancelled by its host.");
if (param("cancelled") || param("map")) history.replaceState(null, "", "/geobarkr/");

$("#play-button").addEventListener("click", (event) => busy(event.currentTarget, async () => {
  if (!mapId) throw new Error("Choose a map first");
  const game = await createGame(mode, mapId);
  try { localStorage.setItem(LAST_MAP, mapId); } catch { /* fine without */ }
  location.href = gamePageUrl({ ...game, status: game.type === "single_player" ? "in_play" : "lobby" }, { isHost: true });
}));

// ---------- Join ----------
const code = codeInput($("#code"));
$("#join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  busy($("#join-button"), async () => {
    const game = await joinGame(code.value);
    location.href = gamePageUrl(game, { isHost: false });
  });
});
