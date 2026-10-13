// In person, the host screen (ServiceNow page "play_localmulti"): Street View
// for the room, the live list of who has guessed (with the guess sound), and
// the round results with the host's buttons.
import { initPage, $, h, busy, param, pageError } from "../ui.js?v=11";
import { endRound, gamePageUrl, resultsUrl } from "../api.js?v=11";
import { watchGameState } from "../live.js?v=11";
import { createPanorama } from "../maps.js?v=11";
import { ResultsPanel, renderGuessList, nextRoundOrResults } from "../round.js?v=11";
import { setupTopbar, renderTopbar, setupCompass } from "../game-chrome.js?v=11";

await initPage({ demoNote: false });
setupTopbar();
const gameId = param("game");
const results = new ResultsPanel();
const panoPromise = createPanorama($("#pano"));
panoPromise.catch((error) => $("#pano").replaceChildren(h("p", { class: "gb-pano-msg" }, error.message)));

// The guess sound. Browsers only play sound after a tap on the page, so the
// button stays until a sound has played.
const sound = new Audio("/geobarkr/assets/guess-sound.mp3");
sound.preload = "auto";
function playSound() {
  sound.currentTime = 0;
  sound.play().then(() => { $("#sound").hidden = true; }).catch(() => { $("#sound").hidden = false; });
}
$("#sound").addEventListener("click", playSound);
$("#home").addEventListener("click", () => panoPromise.then((pano) => pano.home()).catch(() => {}));
setupCompass(panoPromise, $(".gb-sv"));

let roundNumber = null;
let seenGuesses = null;
const watcher = watchGameState(gameId, render, pageError);

$("#end-round").addEventListener("click", () => busy($("#end-round"), async () => {
  await endRound(gameId);
  watcher.refresh();
}));
const goOn = () => nextRoundOrResults(gameId, watcher);

function render(state) {
  const { game, round, guesses, players, me } = state;
  if (!game.is_host || game.type !== "local_multiplayer" || game.status === "lobby") {
    location.replace(gamePageUrl(game, { isHost: game.is_host, isPlayer: me.is_player }));
    return;
  }
  if (game.status !== "in_play" || !round) {
    location.replace(resultsUrl(gameId));
    return;
  }
  renderTopbar(state, { showScore: false });
  if (round.number !== roundNumber) {
    roundNumber = round.number;
    seenGuesses = null;
    results.close();
  }
  if (round.target) panoPromise.then((pano) => pano.show(round.target)).catch(() => {});

  // A new guess came in: play the sound (not for guesses already there on load).
  if (seenGuesses != null && guesses.length > seenGuesses) playSound();
  seenGuesses = guesses.length;

  renderGuessList($("#guess-list"), state);
  $("#progress").textContent = `${guesses.length} of ${players.length} have guessed`;
  $("#end-round").hidden = round.status !== "in_progress";

  if (round.status === "results") {
    const last = round.number >= game.round_count;
    results.open({
      key: round.number,
      title: `Round ${round.number} of ${game.round_count}`,
      state,
      button: { label: last ? "See results" : "Next round", onClick: goOn },
    });
  }
}
