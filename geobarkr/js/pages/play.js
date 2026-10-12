// Single player and online multiplayer (ServiceNow pages "play" and
// "playmulti"): Street View, the guess map, the live guesses list after you've
// guessed, and the round results popup.
import { initPage, $, h, busy, param } from "../ui.js";
import { getGameState, submitGuess, endRound, nextRound, gamePageUrl } from "../api.js";
import { watchGame } from "../live.js";
import { createPanorama, createGuessMap } from "../maps.js";
import { ResultsPopup, renderGuessRows, roundGuessesForMap, signRows } from "../round.js";

await initPage();
const gameId = param("game");
const popup = new ResultsPopup();

const panoPromise = createPanorama($("#pano"));
const mapPromise = createGuessMap($("#map"), () => updateGuessButton());
Promise.all([panoPromise, mapPromise]).catch((error) => {
  $("#pano").replaceChildren(h("p", { class: "gb-pano-message" }, error.message));
});

let state = null;
let roundNumber = null;
let submitting = false;

function updateGuessButton() {
  mapPromise.then((map) => {
    $("#guess").disabled = submitting || !map.getPick();
  }).catch(() => {});
}

$("#home").addEventListener("click", () => panoPromise.then((pano) => pano.home()));

$("#expand").addEventListener("click", () => {
  const panel = $("#panel");
  const expanded = !panel.classList.contains("is-expanded");
  panel.classList.toggle("is-expanded", expanded);
  $("#expand").setAttribute("aria-expanded", String(expanded));
  $("#expand").setAttribute("aria-label", expanded ? "Make the map smaller" : "Make the map bigger");
});

const watcher = watchGame(gameId, async () => render(await getGameState(gameId)));

$("#guess").addEventListener("click", () => {
  busy($("#guess"), async () => {
    const pick = (await mapPromise).getPick();
    if (!pick) return;
    submitting = true;
    try {
      await submitGuess(gameId, pick.lat, pick.lng);
    } finally {
      submitting = false;
    }
    $("#panel").classList.remove("is-expanded");
    watcher.refresh();
  });
});

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

async function render(next) {
  state = next;
  const { game, round, me, guesses, players } = state;

  if (game.type === "local_multiplayer" || game.status === "lobby") {
    location.replace(gamePageUrl(game, { isHost: game.is_host, isPlayer: me.is_player }));
    return;
  }
  if (game.status !== "in_play" || !round) {
    location.replace(`/geobarkr/results/?game=${encodeURIComponent(gameId)}`);
    return;
  }

  const solo = game.type === "single_player";
  document.title = `Round ${round.number} · GeoBarkr`;
  $("#round-badge").hidden = false;
  $("#round-badge").textContent = `Round ${round.number} of ${game.round_count}`;

  // A new round: new place, empty map.
  if (round.number !== roundNumber) {
    roundNumber = round.number;
    popup.close();
    (await mapPromise.catch(() => null))?.reset();
    updateGuessButton();
  }
  if (round.target) {
    panoPromise.then((pano) => pano.show(round.target)).catch(() => {});
  }

  const mine = guesses.find((guess) => guess.user_id === me.user_id);
  const guessing = round.status === "in_progress" && !mine;
  $("#map-box").hidden = !guessing;
  $("#guess").hidden = !guessing;
  $("#waiting").hidden = guessing || solo;
  $("#end-round").hidden = solo || !game.is_host || round.status !== "in_progress";
  if (!guessing) $("#panel").classList.remove("is-expanded");

  renderGuessRows($("#guess-rows"), guesses);
  $("#progress").textContent = `${guesses.length} of ${players.length} players have guessed.`;

  if (round.status === "results") showResults(solo, mine);
}

function showResults(solo, mine) {
  const { game, round } = state;
  const last = round.number >= game.round_count;
  const key = round.number;

  if (solo) {
    popup.open({
      key,
      title: `Round ${round.number} of ${game.round_count}`,
      targets: [round.target],
      guesses: mine ? [{ lat: mine.lat, lng: mine.lng, target: round.target, title: "Your guess" }] : [],
      heading: "Distance to the target",
      rows: [{ name: "You", distance_km: mine?.distance_km ?? null, score: mine?.score ?? null }],
      button: { label: last ? "See results" : "Continue", onClick: goOn },
    });
    return;
  }

  popup.open({
    key,
    title: `Round ${round.number} results`,
    targets: [round.target],
    guesses: roundGuessesForMap(state),
    heading: "Distance to the target",
    rows: signRows(state),
    button: game.is_host ? { label: last ? "See results" : "Next round", onClick: goOn } : null,
    wait: game.is_host ? null : `Waiting for ${game.host_name} to start the next round…`,
  });
}

