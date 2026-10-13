// The start screen (ServiceNow: the "Start Game" record producer): the places
// you've played on a world map, a Resume strip for a game in progress, then
// choose how to play, pick a map and press Play, or join with a room code.
import { initPage, $, h, busy, showError, codeInput, closeButton } from "../ui.js";
import { activeMaps, createGame, joinGame, myGames, gamePageUrl } from "../api.js";
import { drawWorld } from "../worldmap.js";
import { ME_COLOUR } from "../players.js";
import { GAME_TYPES, formatScore } from "../geo.js";

await initPage();

// ---------- Your places, and a game to resume ----------
(async () => {
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
})();

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
const LAST_MAP = "geobarkr-last-map";
const remembered = () => { try { return localStorage.getItem(LAST_MAP); } catch { return null; } };
let maps = [];
let mapId = null;
const picker = $("#map-picker");
$("#map-picker-close").replaceWith(closeButton(() => picker.close()));
picker.addEventListener("click", (event) => { if (event.target === picker) picker.close(); });

function chooseMap(id) {
  mapId = id;
  $("#map-name").textContent = maps.find((m) => m.id === id)?.name || "Choose a map";
}

function renderMaps() {
  const query = $("#map-search").value.trim().toLowerCase();
  const last = remembered();
  const shown = maps
    .filter((m) => !query || m.name.toLowerCase().includes(query))
    .sort((a, b) => (b.id === last) - (a.id === last) || a.name.localeCompare(b.name));
  $("#map-list").replaceChildren(...shown.map((m) => h("button", {
    type: "button", role: "option", class: "gb-pick", "data-id": m.id, "data-name": m.name, "aria-selected": String(m.id === mapId),
    onclick: () => { chooseMap(m.id); picker.close(); },
  }, h("span", { class: "name" }, m.name), m.id === last ? h("span", { class: "gb-tag" }, "Last played") : null,
    h("span", { class: "tick", "aria-hidden": "true" }, "✓"))));
  $("#map-empty").hidden = shown.length > 0;
}

$("#map-search").addEventListener("input", renderMaps);
$("#map-button").addEventListener("click", () => {
  $("#map-search").value = "";
  renderMaps();
  picker.showModal();
});

try {
  maps = await activeMaps();
  if (maps.length) {
    const last = remembered();
    chooseMap(maps.some((m) => m.id === last) ? last : [...maps].sort((a, b) => a.name.localeCompare(b.name))[0].id);
    $("#map-button").disabled = false;
    $("#map-search").hidden = maps.length <= 6; // search only once there are lots
    renderMaps();
  } else {
    $("#map-name").textContent = "No maps yet";
  }
} catch (error) {
  $("#map-name").textContent = "Couldn't load maps";
  showError(error);
}

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
