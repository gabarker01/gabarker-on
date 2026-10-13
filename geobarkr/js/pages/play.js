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
import { haptic } from "../motion.js";

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

// ---------- The map bubble: tucked in the corner, or open as a card ----------
const panel = $("#guess-panel");
let openView = null; // where the open map was looking, to go back to it
let mapReady = null;
mapPromise.then((map) => { mapReady = map; }).catch(() => {});
function setPanel(state) {
  const was = panel.dataset.state;
  if (was === state) return;
  const map = mapReady; // null until the map has loaded: just switch the panel
  if (was === "open" && map) openView = map.getView();
  panel.dataset.state = state;
  if (!map) return;
  const pick = map.getPick();
  if (state === "bubble") {
    // The bubble shows your pin up close once you've placed one, else the world.
    if (pick) map.setView(pick, 4);
    else map.world();
  } else if (state === "open" && openView) {
    map.setView(openView.center, openView.zoom);
  }
  $("#quick-guess").hidden = !pick;
  $("#open-hint").hidden = Boolean(pick);
}
const openMap = () => setPanel("open");
$("#open-map").addEventListener("click", openMap);
$("#open-hint").addEventListener("click", openMap);
$("#shrink").addEventListener("click", () => setPanel("bubble"));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && panel.dataset.state === "open" && !document.querySelector("dialog[open]")) setPanel("bubble");
});
Promise.all([panoPromise, mapPromise]).catch((error) => {
  $("#pano").replaceChildren(h("p", { class: "gb-pano-msg" }, error.message));
  $("#map").replaceChildren(h("p", { class: "gb-pano-msg" }, "No map without the Google Maps key"));
});

let roundNumber = null;
let submitting = false;

function updateGuessButton() {
  mapPromise.then((map) => {
    $("#guess").disabled = submitting || !map.getPick();
    $("#quick-guess").disabled = submitting;
  }).catch(() => {});
}

$("#home").addEventListener("click", () => panoPromise.then((pano) => pano.home()).catch(() => {}));

const watcher = watchGameState(gameId, render, pageError);

// Stays disabled after a guess is sent (until the next round): no double sends.
async function sendGuess() {
  const pick = (await mapPromise).getPick();
  if (!pick || submitting) return;
  submitting = true;
  $("#guess").disabled = true;
  try {
    await submitGuess(gameId, pick.lat, pick.lng);
    haptic(12);
    watcher.refresh();
  } catch (error) {
    submitting = false;
    updateGuessButton();
    showError(error);
  }
}
$("#guess").addEventListener("click", sendGuess);
$("#quick-guess").addEventListener("click", sendGuess);

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
    openView = null;
    $("#coords").textContent = "Tap the map to place it";
    $("#quick-guess").hidden = true;
    $("#open-hint").hidden = false;
    panel.dataset.state = "bubble";
    updateGuessButton();
  }
  if (round.target) panoPromise.then((pano) => pano.show(round.target)).catch(() => {});

  const mine = guesses.find((g) => g.user_id === who.user_id);
  const guessing = round.status === "in_progress" && !mine;
  $("#waiting").hidden = guessing || solo;
  $("#end-round").hidden = solo || !game.is_host || round.status !== "in_progress";
  // After your guess (multiplayer): the card shows who has guessed so far;
  // back to the bubble once the round is over.
  if (!guessing && !solo && round.status === "in_progress") panel.dataset.state = "done";
  else if (round.status !== "in_progress" && panel.dataset.state === "done") panel.dataset.state = "bubble";

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
