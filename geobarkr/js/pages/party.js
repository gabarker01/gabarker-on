// In person, a player's phone (ServiceNow page "map_mobile"): your map and the
// Guess button. Street View is on the host's big screen; phones are never sent
// the target during a round.
import { initPage, $, h, param, showError, pageError } from "../ui.js";
import { submitGuess, gamePageUrl, resultsUrl } from "../api.js";
import { watchGameState } from "../live.js";
import { createGuessMap } from "../maps.js";
import { setupTopbar, renderTopbar } from "../game-chrome.js";
import { avatar, ME_COLOUR } from "../players.js";
import { formatCoords, formatDistance, formatScore, firstName } from "../geo.js";

const { profile } = await initPage({ demoNote: false });
setupTopbar();
const gameId = param("game");
const me = { player: { name: profile?.display_name, avatar_url: profile?.avatar_url }, colour: ME_COLOUR };
$("#status-avatar").replaceWith(avatar(me.player, ME_COLOUR, 56));

const mapPromise = createGuessMap($("#map"), me, (pick) => {
  $("#coords").textContent = formatCoords(pick.lat, pick.lng);
  if (!sending) $("#guess").disabled = false;
});
mapPromise.catch((error) => $("#map").replaceChildren(h("p", { class: "gb-pano-msg" }, error.message)));

let roundNumber = null;
let sending = false;
const watcher = watchGameState(gameId, render, pageError);

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

function showStatus(title, text, summary = null) {
  for (const id of ["#map-box", "#readout", "#guess"]) $(id).hidden = true;
  $("#status").hidden = false;
  $("#status-title").textContent = title;
  $("#status-text").textContent = text;
  $("#status-summary").replaceChildren(...(summary || []));
}

async function render(state) {
  const { game, round, me: who, guesses } = state;
  if (game.type !== "local_multiplayer" || game.is_host || game.status === "lobby") {
    location.replace(gamePageUrl(game, { isHost: game.is_host, isPlayer: who.is_player }));
    return;
  }
  if (game.status !== "in_play" || !round) {
    location.replace(resultsUrl(gameId));
    return;
  }
  renderTopbar(state);
  if (round.number !== roundNumber) {
    roundNumber = round.number;
    sending = false;
    (await mapPromise.catch(() => null))?.reset();
    $("#guess").disabled = true;
    $("#coords").textContent = "Tap the map to place it";
  }

  const mine = guesses.find((g) => g.user_id === who.user_id);
  if (round.status === "results") {
    const last = round.number >= game.round_count;
    showStatus(
      round.place ? `It was ${round.place}` : "Round complete",
      last ? "That was the last round. The results appear here when the host is ready." : "The next round starts here when the host is ready.",
      [h("div", { class: "k" }, mine ? "You were" : "The host ended the round before you guessed"),
        h("div", { class: "row" },
          h("span", { class: "km" }, mine ? `${formatDistance(mine.distance_km)} km away` : "0 points"),
          mine ? h("span", { class: "pts" }, `+${formatScore(mine.score)}`) : null)],
    );
  } else if (mine) {
    showStatus(`Locked in, ${firstName(who.display_name)}`, "Waiting for everyone else to guess…");
  } else {
    $("#status").hidden = true;
    for (const id of ["#map-box", "#readout", "#guess"]) $(id).hidden = false;
  }
}
