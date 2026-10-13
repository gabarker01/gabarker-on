// Solo and online play (ServiceNow pages "play" and "playmulti"): Street View,
// the guess map with your pin, the live guesses list after you've guessed,
// and the round results.
import { initPage, $, h, busy, param, showError, pageError } from "../ui.js";
import { submitGuess, endRound, gamePageUrl, resultsUrl } from "../api.js";
import { watchGameState } from "../live.js";
import { createPanorama, createGuessMap } from "../maps.js";
import { ResultsPanel, renderGuessList, nextRoundOrResults } from "../round.js";
import { setupTopbar, renderTopbar } from "../game-chrome.js";
import { ME_COLOUR } from "../players.js";
import { formatCoords } from "../geo.js";

const { profile } = await initPage({ demoNote: false });
setupTopbar();
const gameId = param("game");
const results = new ResultsPanel();
const me = { player: { name: profile?.display_name, avatar_url: profile?.avatar_url }, colour: ME_COLOUR };

const panoPromise = createPanorama($("#pano"));
const mapPromise = createGuessMap($("#map"), me, (pick) => {
  $("#coords").textContent = formatCoords(pick.lat, pick.lng);
  updateGuessButton();
});
Promise.all([panoPromise, mapPromise]).catch((error) => {
  $("#pano").replaceChildren(h("p", { class: "gb-pano-msg" }, error.message));
  $("#map").replaceChildren(h("p", { class: "gb-pano-msg" }, "No map without the Google Maps key"));
});

let roundNumber = null;
let submitting = false;

function updateGuessButton() {
  mapPromise.then((map) => { $("#guess").disabled = submitting || !map.getPick(); }).catch(() => {});
}

$("#home").addEventListener("click", () => panoPromise.then((pano) => pano.home()).catch(() => {}));
$("#expand").addEventListener("click", () => {
  const sheet = $("#sheet");
  const expanded = !sheet.classList.contains("is-expanded");
  sheet.classList.toggle("is-expanded", expanded);
  $("#expand").setAttribute("aria-expanded", String(expanded));
  $("#expand").setAttribute("aria-label", expanded ? "Make the map smaller" : "Make the map bigger");
});

const watcher = watchGameState(gameId, render, pageError);

// Stays disabled after a guess is sent (until the next round): no double sends.
$("#guess").addEventListener("click", async () => {
  const pick = (await mapPromise).getPick();
  if (!pick || submitting) return;
  submitting = true;
  $("#guess").disabled = true;
  try {
    await submitGuess(gameId, pick.lat, pick.lng);
    $("#sheet").classList.remove("is-expanded");
    watcher.refresh();
  } catch (error) {
    submitting = false;
    updateGuessButton();
    showError(error);
  }
});

$("#end-round").addEventListener("click", () => busy($("#end-round"), async () => {
  await endRound(gameId);
  watcher.refresh();
}));

const goOn = () => nextRoundOrResults(gameId, watcher);

async function render(state) {
  const { game, round, me: who, guesses, players } = state;
  if (game.type === "local_multiplayer" || game.status === "lobby") {
    location.replace(gamePageUrl(game, { isHost: game.is_host, isPlayer: who.is_player }));
    return;
  }
  if (game.status !== "in_play" || !round) {
    location.replace(resultsUrl(gameId));
    return;
  }
  const solo = game.type === "single_player";
  renderTopbar(state);

  if (round.number !== roundNumber) {
    roundNumber = round.number;
    submitting = false;
    results.close();
    (await mapPromise.catch(() => null))?.reset();
    $("#coords").textContent = "Tap the map to place it";
    updateGuessButton();
  }
  if (round.target) panoPromise.then((pano) => pano.show(round.target)).catch(() => {});

  const mine = guesses.find((g) => g.user_id === who.user_id);
  const guessing = round.status === "in_progress" && !mine;
  $("#map-box").hidden = !guessing;
  $("#readout").hidden = !guessing;
  $("#guess").hidden = !guessing;
  $("#waiting").hidden = guessing || solo;
  $("#end-round").hidden = solo || !game.is_host || round.status !== "in_progress";
  if (!guessing) $("#sheet").classList.remove("is-expanded");

  renderGuessList($("#guess-list"), state);
  $("#progress").textContent = `${guesses.length} of ${players.length} have guessed`;

  if (round.status === "results") {
    const last = round.number >= game.round_count;
    results.open({
      key: round.number,
      title: `Round ${round.number} of ${game.round_count}`,
      state,
      button: game.is_host ? { label: last ? "See results" : "Next round", onClick: goOn } : null,
      wait: game.is_host ? null : `Waiting for ${game.host_name} to start the next round…`,
    });
  }
}
