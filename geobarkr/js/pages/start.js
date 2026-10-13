// The landing page: your last game on a world map, then start or join a game
// (ServiceNow: the "Start Game" record producer).
import { initPage, $, h, busy, showError, codeInput } from "../ui.js";
import { activeMaps, createGame, joinGame, myGames, gamePageUrl } from "../api.js";
import { drawWorld } from "../worldmap.js";
import { ME_COLOUR } from "../players.js";
import { GAME_TYPES, formatScore, ordinal } from "../geo.js";

const { profile } = await initPage();

// ---------- Your last game, on the map ----------
(async () => {
  const caption = $("#band-caption");
  let last = null;
  try {
    const games = (await myGames()).filter((g) => g.places?.length);
    last = games.find((g) => g.my_score != null) || games[0] || null;
  } catch { /* the map still draws */ }
  const places = last?.places || [];
  await drawWorld($("#band"), {
    view: { lat: 18, lng: 12, zoom: 0.05 },
    arcs: places.filter((p) => p.guess_lat != null).map((p) => ({ from: { lat: p.guess_lat, lng: p.guess_lng }, to: p, colour: ME_COLOUR, width: 2.4 })),
    dots: [
      ...places.map((p) => ({ lat: p.lat, lng: p.lng, colour: "#fff", r: 4 })),
      ...places.filter((p) => p.guess_lat != null).map((p) => ({ lat: p.guess_lat, lng: p.guess_lng, colour: ME_COLOUR, r: 3.6 })),
    ],
  });
  if (last) {
    const finished = last.status === "complete";
    caption.replaceChildren(
      h("div", {}, h("div", { class: "k" }, finished ? "Your last game" : "Your game in progress"), h("div", { class: "v" }, `${last.map_name}, ${GAME_TYPES[last.type].toLowerCase()}`)),
      last.my_score != null ? h("a", { class: "score", href: gamePageUrl(last, { isHost: last.is_host, isPlayer: true }) },
        h("b", {}, formatScore(last.my_score)),
        h("span", {}, last.type === "single_player" ? "points" : `${ordinal(last.my_rank)} of ${last.player_count}`)) : null,
    );
  } else {
    caption.replaceChildren(h("div", {}, h("div", { class: "k" }, "Welcome"), h("div", { class: "v" }, `${profile?.display_name || "Hi"}. Where will you be dropped?`)));
  }
})();

// ---------- New game ----------
const select = $("#map-select");
try {
  const maps = await activeMaps();
  select.replaceChildren(...(maps.length
    ? maps.map((map) => h("option", { value: map.id }, `Map: ${map.name}`))
    : [h("option", { value: "" }, "No maps yet")]));
} catch (error) {
  select.replaceChildren(h("option", { value: "" }, "Couldn't load maps"));
  showError(error);
}

for (const button of document.querySelectorAll("#modes .gb-row")) {
  button.addEventListener("click", () => busy(button, async () => {
    if (!select.value) throw new Error("Choose a map first");
    const game = await createGame(button.dataset.type, select.value);
    location.href = gamePageUrl({ ...game, status: game.type === "single_player" ? "in_play" : "lobby" }, { isHost: true });
  }));
}

// ---------- Join ----------
const code = codeInput($("#code"));
$("#join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  busy($("#join-button"), async () => {
    const game = await joinGame(code.value);
    location.href = gamePageUrl(game, { isHost: false });
  });
});
