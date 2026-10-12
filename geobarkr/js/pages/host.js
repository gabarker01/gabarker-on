// In person, the host screen (ServiceNow page "play_localmulti"): big Street
// View for the room, the live list of who has guessed (with the sound effect
// for each new guess), and the round results with the host's buttons.
import { initPage, $, h, busy, param } from "../ui.js";
import { getGameState, endRound, nextRound, gamePageUrl } from "../api.js";
import { watchGame } from "../live.js";
import { createPanorama } from "../maps.js";
import { ResultsPopup, renderGuessRows, roundGuessesForMap, signRows } from "../round.js";

await initPage();
const gameId = param("game");
const popup = new ResultsPopup();
const panoPromise = createPanorama($("#pano"));
panoPromise.catch((error) => $("#pano").replaceChildren(h("p", { class: "gb-pano-message" }, error.message)));

// The guess sound. Browsers only play sound after a tap on the page, so the
// button stays until a sound has played.
const sound = new Audio("/geobarkr/assets/guess-sound.mp3");
sound.preload = "auto";
function playSound() {
  sound.currentTime = 0;
  sound.play().then(() => { $("#sound").hidden = true; }).catch(() => { $("#sound").hidden = false; });
}
$("#sound").addEventListener("click", playSound);

$("#home").addEventListener("click", () => panoPromise.then((pano) => pano.home()));

let roundNumber = null;
let seenGuesses = null;

const watcher = watchGame(gameId, async () => render(await getGameState(gameId)));

$("#end-round").addEventListener("click", () => {
  busy($("#end-round"), async () => {
    await endRound(gameId);
    watcher.refresh();
  });
});

async function goOn() {
  const result = await nextRound(gameId);
  if (result === "complete") location.replace(`/geobarkr/results/?game=${encodeURIComponent(gameId)}`);
  else watcher.refresh();
}

function render(state) {
  const { game, round, guesses, players, me } = state;
  if (!game.is_host || game.type !== "local_multiplayer" || game.status === "lobby") {
    location.replace(gamePageUrl(game, { isHost: game.is_host, isPlayer: me.is_player }));
    return;
  }
  if (game.status !== "in_play" || !round) {
    location.replace(`/geobarkr/results/?game=${encodeURIComponent(gameId)}`);
    return;
  }

  document.title = `Round ${round.number} · GeoBarkr`;
  $("#round-badge").hidden = false;
  $("#round-badge").textContent = `Round ${round.number} of ${game.round_count}`;
  if (round.number !== roundNumber) {
    roundNumber = round.number;
    seenGuesses = null;
    popup.close();
  }
  if (round.target) panoPromise.then((pano) => pano.show(round.target)).catch(() => {});

  // A new guess came in: play the sound (not for guesses already there on load).
  if (seenGuesses != null && guesses.length > seenGuesses) playSound();
  seenGuesses = guesses.length;

  renderGuessRows($("#guess-rows"), guesses);
  $("#progress").textContent = `${guesses.length} of ${players.length} players have guessed.`;
  $("#end-round").hidden = round.status !== "in_progress";

  if (round.status === "results") {
    const last = round.number >= game.round_count;
    popup.open({
      key: round.number,
      title: `Round ${round.number} results`,
      targets: [round.target],
      guesses: roundGuessesForMap(state),
      heading: "Distance to the target",
      rows: signRows(state),
      button: { label: last ? "See results" : "Next round", onClick: goOn },
    });
  }
}
