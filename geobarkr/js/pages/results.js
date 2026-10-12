// Results (ServiceNow pages "geobarkr_results_single" and
// "geobarkr_results_multi"): the scorecard with every guess on a map, and for
// multiplayer the table of everyone's rounds, highest total first.
import { initPage, $, h, param, showError } from "../ui.js";
import { getResults, gamePageUrl } from "../api.js";
import { createResultsMap } from "../maps.js";
import { formatDistance, formatScore, formatTime, formatDate, ordinal } from "../geo.js";

const { profile } = await initPage();
const gameId = param("game");

const TYPE_TEXT = {
  single_player: "a single-player game",
  multiplayer: "a multiplayer game",
  local_multiplayer: "an in-person game",
};

let data;
try {
  data = await getResults(gameId);
} catch (error) {
  $("#loading").textContent = `${error.message}. It may have been deleted, or you weren't in it.`;
  throw error;
}
const { game, rounds, players } = data;
$("#loading").hidden = true;
$("#results-page").hidden = false;

$("#summary").textContent = `${game.map_name}, ${TYPE_TEXT[game.type]} on ${formatDate(game.created_at)}.`;
if (game.status === "in_play" || game.status === "lobby") {
  const back = h("a", { href: gamePageUrl(game, { isHost: game.is_host, isPlayer: players.some((p) => p.is_me) }) }, "Go back to the game");
  $("#unfinished").replaceChildren("This game is still being played, so only finished rounds are shown. ", back, ".");
  $("#unfinished").hidden = false;
}

const roundNumbers = rounds.map((round) => round.number);

// ---------- Everyone (multiplayer) ----------

if (game.type !== "single_player") {
  $("#table-section").hidden = false;
  const head = h("thead", {}, h("tr", {},
    h("th", {}, "Player"),
    roundNumbers.map((n) => h("th", { class: "gb-num" }, `Round ${n}`)),
    h("th", { class: "gb-num" }, "Total"),
  ));
  const body = h("tbody", {}, players.map((player, index) => {
    const byRound = new Map(player.guesses.map((guess) => [guess.round, guess]));
    return h("tr", { class: player.is_me ? "is-me" : false },
      h("td", {}, h("span", { class: "gb-strong" }, player.name), h("span", { class: "gb-meta" }, ordinal(index + 1))),
      roundNumbers.map((n) => {
        const guess = byRound.get(n);
        return h("td", { class: "gb-num" }, guess
          ? [formatScore(guess.score), h("span", { class: "gb-meta" }, `${formatDistance(guess.distance_km)} km, ${formatTime(guess.time_ms)}`)]
          : ["0", h("span", { class: "gb-meta" }, "No guess")]);
      }),
      h("td", { class: "gb-num gb-strong" }, formatScore(player.total_score),
        h("span", { class: "gb-meta" }, `${formatDistance(player.total_distance_km)} km, ${formatTime(player.total_time_ms)}`)),
    );
  }));
  $("#multi-table").replaceChildren(head, body);
}

// ---------- My scorecard ----------

const me = players.find((player) => player.is_me);
if (me) {
  $("#scorecard-section").hidden = false;
  $("#scorecard-title").textContent = `${profile?.display_name || me.name}'s scorecard`;
  const byRound = new Map(me.guesses.map((guess) => [guess.round, guess]));
  $("#scorecard").replaceChildren(
    h("thead", {}, h("tr", {},
      h("th", {}, "Round"), h("th", { class: "gb-num" }, "Distance (km)"), h("th", { class: "gb-num" }, "Time"), h("th", { class: "gb-num" }, "Score"))),
    h("tbody", {},
      roundNumbers.map((n) => {
        const guess = byRound.get(n);
        return h("tr", {},
          h("td", {}, n),
          h("td", { class: "gb-num" }, guess ? formatDistance(guess.distance_km) : "No guess"),
          h("td", { class: "gb-num" }, guess ? formatTime(guess.time_ms) : ""),
          h("td", { class: "gb-num gb-strong" }, guess ? formatScore(guess.score) : "0"));
      }),
      h("tr", { class: "gb-total" },
        h("td", {}, "Total"),
        h("td", { class: "gb-num" }, formatDistance(me.total_distance_km)),
        h("td", { class: "gb-num" }, formatTime(me.total_time_ms)),
        h("td", { class: "gb-num" }, formatScore(me.total_score))),
    ),
  );

  const targets = new Map(rounds.map((round) => [round.number, { lat: round.lat, lng: round.lng }]));
  createResultsMap($("#results-map")).then((map) => map.show({
    targets: [...targets.values()],
    guesses: me.guesses.map((guess) => ({ lat: guess.lat, lng: guess.lng, target: targets.get(guess.round), title: `Round ${guess.round}` })),
  })).catch((error) => {
    $("#results-map").replaceChildren(h("p", { class: "gb-pano-message" }, error.message));
    showError(error);
  });
}
