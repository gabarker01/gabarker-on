// Joining on a phone (ServiceNow: "GeoBarkr Join Local Game"). Opening the QR
// link joins straight away; without a code you type one in. In-person players
// wait here until the host starts, then go to the phone map.
import { initPage, $, busy, param } from "../ui.js";
import { joinGame, getGameState, gamePageUrl } from "../api.js";
import { watchGame } from "../live.js";

const { profile } = await initPage();

function askForCode(message) {
  $("#joining").hidden = true;
  $("#code-form").hidden = false;
  $("#code-error").hidden = !message;
  $("#code-error").textContent = message || "";
  const code = param("code");
  if (code) $("#code").value = code.toUpperCase();
}

function waitInGame(gameId) {
  watchGame(gameId, async () => {
    const { game, me } = await getGameState(gameId);
    if (game.type !== "local_multiplayer" || game.is_host || game.status !== "lobby") {
      location.replace(gamePageUrl(game, { isHost: game.is_host, isPlayer: me.is_player }));
      return;
    }
    $("#joining").hidden = true;
    $("#welcome").hidden = false;
    $("#welcome-title").textContent = `Welcome ${profile?.display_name || ""}, you're in!`;
    $("#round-count").textContent = `${game.round_count} round${game.round_count === 1 ? "" : "s"}`;
  });
}

async function join(code, button) {
  return busy(button, async () => {
    const game = await joinGame(code);
    history.replaceState(null, "", `/geobarkr/join/?game=${encodeURIComponent(game.id)}`);
    $("#code-form").hidden = true;
    $("#joining").hidden = false;
    waitInGame(game.id);
  });
}

const code = $("#code");
code.addEventListener("input", () => {
  code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
$("#code-form").addEventListener("submit", (event) => {
  event.preventDefault();
  join(code.value, $("#join-button"));
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
