// The start screen (ServiceNow: the "Start Game" record producer): the places
// you've played on a world map, a Resume strip for a game in progress, then
// choose how to play, pick a map and press Play, or join with a room code.
import { initPage, $, h, busy, showError, codeInput } from "../ui.js";
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

const select = $("#map-select");
try {
  const maps = await activeMaps();
  select.replaceChildren(...(maps.length
    ? maps.map((map) => h("option", { value: map.id }, map.name))
    : [h("option", { value: "" }, "No maps yet")]));
} catch (error) {
  select.replaceChildren(h("option", { value: "" }, "Couldn't load maps"));
  showError(error);
}

$("#play-button").addEventListener("click", (event) => busy(event.currentTarget, async () => {
  if (!select.value) throw new Error("Choose a map first");
  const game = await createGame(mode, select.value);
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
