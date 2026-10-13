// Results (ServiceNow pages "geobarkr_results_single" and
// "geobarkr_results_multi"): every round on a world map, the standings for
// multiplayer, and your rounds.
import { initPage, $, h, param } from "../ui.js";
import { getResults, gamePageUrl } from "../api.js";
import { drawWorld } from "../worldmap.js";
import { avatar, colourMap, ME_COLOUR } from "../players.js";
import { formatDistance, formatScore, formatTime, formatDate, ordinal, GAME_TYPES } from "../geo.js";

await initPage();
const gameId = param("game");

let data;
try {
  data = await getResults(gameId);
} catch (error) {
  $("#loading").textContent = `${error.message}. It may have been deleted, or you weren't in it.`;
  throw error;
}
const { game, rounds, players } = data;
const me = players.find((p) => p.is_me);
const colours = colourMap(players.map((p) => ({ user_id: p.user_id, joined_at: p.joined_at })), me?.user_id);
$("#loading").hidden = true;
$("#results-page").hidden = false;

// The map: every place, and your guesses with great-circle lines.
const targets = new Map(rounds.map((r) => [r.number, r]));
drawWorld($("#band"), {
  view: { lat: 18, lng: 12, zoom: 0.05 },
  arcs: (me?.guesses || []).map((g) => ({ from: g, to: targets.get(g.round), colour: ME_COLOUR, width: 2.4 })),
  dots: [...rounds.map((r) => ({ lat: r.lat, lng: r.lng, colour: "#fff", r: 4 })), ...(me?.guesses || []).map((g) => ({ lat: g.lat, lng: g.lng, colour: ME_COLOUR, r: 3.6 }))],
});
if (me) {
  const place = players.indexOf(me) + 1;
  $("#band-caption").replaceChildren(
    h("div", {}, h("div", { class: "k" }, "Your score"), h("div", { class: "v" }, game.type === "single_player" ? `${game.map_name}` : `${ordinal(place)} of ${players.length}`)),
    h("div", { class: "score" }, h("b", {}, formatScore(me.total_score)), h("span", {}, `${formatDistance(me.total_distance_km)} km off in total`)),
  );
}

$("#summary").textContent = `${game.map_name}, ${GAME_TYPES[game.type].toLowerCase()}, ${formatDate(game.created_at)}.`;
if (game.status === "in_play" || game.status === "lobby") {
  $("#unfinished").replaceChildren("This game is still being played, so only finished rounds are shown. ",
    h("a", { href: gamePageUrl(game, { isHost: game.is_host, isPlayer: Boolean(me) }) }, "Go back to the game"), ".");
  $("#unfinished").hidden = false;
}

// ---------- Standings (multiplayer) ----------
if (game.type !== "single_player") {
  $("#table-section").hidden = false;
  const numbers = rounds.map((r) => r.number);
  $("#standings").replaceChildren(
    h("thead", {}, h("tr", {}, h("th", {}, "Player"), numbers.map((n) => h("th", { class: "r" }, `R${n}`)), h("th", { class: "r" }, "Total"))),
    h("tbody", {}, players.map((p, i) => {
      const byRound = new Map(p.guesses.map((g) => [g.round, g]));
      return h("tr", { class: p.is_me ? "is-me" : false },
        h("td", {}, h("span", { class: "who" }, h("span", { class: "gb-muted" }, ordinal(i + 1)), avatar(p, colours.get(p.user_id), 28), p.name)),
        numbers.map((n) => {
          const g = byRound.get(n);
          return h("td", { class: "r" }, g ? formatScore(g.score) : "0", h("span", { class: "meta" }, g ? `${formatDistance(g.distance_km)} km` : "No guess"));
        }),
        h("td", { class: "r" }, h("b", {}, formatScore(p.total_score)), h("span", { class: "meta" }, formatTime(p.total_time_ms))));
    })),
  );
}

// ---------- Your rounds ----------
if (me) {
  $("#scorecard-section").hidden = false;
  const byRound = new Map(me.guesses.map((g) => [g.round, g]));
  $("#scorecard").replaceChildren(
    h("thead", {}, h("tr", {}, h("th", {}, "Round"), h("th", { class: "r" }, "Distance"), h("th", { class: "r" }, "Time"), h("th", { class: "r" }, "Score"))),
    h("tbody", {},
      rounds.map((r) => {
        const g = byRound.get(r.number);
        return h("tr", {},
          h("td", {}, h("b", {}, r.number), " ", r.name),
          h("td", { class: "r" }, g ? `${formatDistance(g.distance_km)} km` : "No guess"),
          h("td", { class: "r" }, g ? formatTime(g.time_ms) : ""),
          h("td", { class: "r" }, h("b", {}, g ? formatScore(g.score) : "0")));
      }),
      h("tr", {}, h("td", {}, h("b", {}, "Total")), h("td", { class: "r" }, `${formatDistance(me.total_distance_km)} km`),
        h("td", { class: "r" }, formatTime(me.total_time_ms)), h("td", { class: "r" }, h("b", {}, formatScore(me.total_score))))),
  );
}
