// In person, a player's phone (ServiceNow page "map_mobile"): just the map and
// the Guess button. The Street View is on the host's big screen; phones are
// never sent the target during a round.
import { initPage, $, h, param, showError, pageError } from "../ui.js";
import { submitGuess, gamePageUrl, resultsUrl } from "../api.js";
import { watchGameState } from "../live.js";
import { createGuessMap } from "../maps.js";
import { formatDistance, formatScore, firstName } from "../geo.js";

await initPage();
const gameId = param("game");

const mapPromise = createGuessMap($("#map"), () => {
  $("#guess").disabled = false;
  $("#guess").textContent = "Guess";
});
mapPromise.catch((error) => $("#map").replaceChildren(h("p", { class: "gb-pano-message" }, error.message)));

let roundNumber = null;
let sending = false;
const watcher = watchGameState(gameId, render, pageError);

// Stays disabled once sent, so a second tap can't send the guess twice.
$("#guess").addEventListener("click", async () => {
  const pick = (await mapPromise).getPick();
  if (!pick || sending) return;
  sending = true;
  $("#guess").disabled = true;
  try {
    await submitGuess(gameId, pick.lat, pick.lng);
    watcher.refresh();
  } catch (error) {
    sending = false;
    $("#guess").disabled = false;
    showError(error);
  }
});

function showStatus(title, text, sign) {
  $("#map-box").hidden = true;
  $("#guess").hidden = true;
  $("#status").hidden = false;
  $("#status-title").textContent = title;
  $("#status-text").textContent = text;
  $("#status-sign").hidden = !sign;
  if (sign) $("#status-sign").replaceChildren(...sign);
}

async function render(state) {
  const { game, round, me, guesses } = state;
  if (game.type !== "local_multiplayer" || game.is_host || game.status === "lobby") {
    location.replace(gamePageUrl(game, { isHost: game.is_host, isPlayer: me.is_player }));
    return;
  }
  if (game.status !== "in_play" || !round) {
    location.replace(resultsUrl(gameId));
    return;
  }

  $("#round-head").textContent = `Round ${round.number} of ${game.round_count}`;
  document.title = `Round ${round.number} · GeoBarkr`;

  if (round.number !== roundNumber) {
    roundNumber = round.number;
    sending = false;
    (await mapPromise.catch(() => null))?.reset();
    $("#guess").disabled = true;
    $("#guess").textContent = "Tap the map to place your guess";
  }

  const mine = guesses.find((guess) => guess.user_id === me.user_id);
  if (round.status === "results") {
    const row = mine
      ? h("div", { class: "gb-distance-row" }, h("span", { class: "gb-name" }, "You"),
        h("span", {}, `${formatDistance(mine.distance_km)} km`), h("span", { class: "gb-points" }, `+${formatScore(mine.score)}`))
      : h("div", { class: "gb-distance-row is-none" }, h("span", { class: "gb-name" }, "No guess"), h("span", {}, ""), h("span", { class: "gb-points" }, "0"));
    showStatus(
      "Round complete",
      round.number >= game.round_count
        ? "That was the last round. The results appear here when the host is ready."
        : "The next round starts here when the host is ready.",
      [h("h3", {}, mine ? "Distance to the target" : "The host ended the round before you guessed"), row],
    );
  } else if (mine) {
    showStatus(
      `Cheers ${firstName(me.display_name)}!`,
      "Your guess is locked in. Waiting for the other players to guess…",
    );
  } else {
    $("#status").hidden = true;
    $("#map-box").hidden = false;
    $("#guess").hidden = false;
  }
}
