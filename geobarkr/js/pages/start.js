// Start Game (ServiceNow: the "Start Game" record producer) and join by code.
import { initPage, $, h, busy, showError, codeInput } from "../ui.js";
import { activeMaps, createGame, joinGame, gamePageUrl } from "../api.js";

await initPage();

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

$("#start-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  busy($("#start-button"), async () => {
    const game = await createGame(form.get("type"), form.get("map"));
    location.href = gamePageUrl({ ...game, status: game.type === "single_player" ? "in_play" : "lobby" }, { isHost: true });
  });
});

const code = codeInput($("#code"));

$("#join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  busy($("#join-button"), async () => {
    const game = await joinGame(code.value);
    location.href = gamePageUrl(game, { isHost: false });
  });
});
