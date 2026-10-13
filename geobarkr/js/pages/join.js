// Joining on a phone (ServiceNow: "GeoBarkr Join Local Game"). Opening the QR
// link joins straight away; without a code you type one in. In-person players
// wait here until the host starts, then go to the phone map.
import { initPage, $, busy, param, codeInput } from "../ui.js";
import { joinGame, gamePageUrl } from "../api.js";
import { watchGameState } from "../live.js";
import { drawWorld } from "../worldmap.js";

const { profile } = await initPage();
drawWorld($("#band"), { view: { lat: 25, lng: 10, zoom: 0.05 } });

function askForCode(message) {
  $("#joining").hidden = true;
  $("#code-form").hidden = false;
  $("#code-error").hidden = !message;
  $("#code-error").textContent = message || "";
  const code = param("code");
  if (code) $("#code").value = code.toUpperCase();
}

function waitInGame(gameId) {
  watchGameState(gameId, async ({ game, me }) => {
    if (game.type !== "local_multiplayer" || game.is_host || game.status !== "lobby") {
      location.replace(gamePageUrl(game, { isHost: game.is_host, isPlayer: me.is_player }));
      return;
    }
    $("#joining").hidden = true;
    $("#welcome").hidden = false;
    $("#welcome-title").textContent = `You're in, ${profile?.display_name || "player"}`;
    $("#round-count").textContent = `${game.round_count} round${game.round_count === 1 ? "" : "s"}`;
  }, (error) => askForCode(`${error.message}. Try the room code instead.`));
}

const code = codeInput($("#code"));
$("#code-form").addEventListener("submit", (event) => {
  event.preventDefault();
  busy($("#join-button"), async () => {
    const game = await joinGame(code.value);
    history.replaceState(null, "", `/geobarkr/join/?game=${encodeURIComponent(game.id)}`);
    $("#code-form").hidden = true;
    $("#joining").hidden = false;
    waitInGame(game.id);
  });
});

if (param("game")) {
  waitInGame(param("game"));
} else if (param("code")) {
  try {
    const game = await joinGame(param("code"));
    history.replaceState(null, "", `/geobarkr/join/?game=${encodeURIComponent(game.id)}`);
    waitInGame(game.id);
  } catch (error) {
    askForCode(error.message);
  }
} else {
  askForCode();
}
