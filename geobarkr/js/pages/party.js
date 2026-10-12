// In person, a player's phone (ServiceNow page "map_mobile"): just the map and
// the Guess button. The Street View is on the host's big screen; phones are
// never sent the target during a round.
import { initPage, $, h, busy, param } from "../ui.js";
import { getGameState, submitGuess, gamePageUrl } from "../api.js";
import { watchGame } from "../live.js";
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
const watcher = watchGame(gameId, async () => render(await getGameState(gameId)));

$("#guess").addEventListener("click", () => {
  busy($("#guess"), async () => {
    const pick = (await mapPromise).getPick();
    if (!pick) return;
    await submitGuess(gameId, pick.lat, pick.lng);
    watcher.refresh();
  });
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
    location.replace(`/geobarkr/results/?game=${encodeURIComponent(gameId)}`);
    return;
  }

  $("#round-head").textContent = `Round ${round.number} of ${game.round_count}`;
  document.title = `Round ${round.number} · GeoBarkr`;

  if (round.number !== roundNumber) {
    roundNumber = round.number;
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
      [h("h3", {}, mine ? "Your guess" : "The host ended the round before you guessed"), row],
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
