// Game results (ServiceNow pages "geobarkr_results_single" and
// "geobarkr_results_multi"): every round on a world map, the winner, your
// stats (points, distance, time), the standings and each round in detail.
import { initPage, $, h, param } from "../ui.js?v=14";
import { getResults, gamePageUrl } from "../api.js?v=14";
import { drawWorld } from "../worldmap.js?v=14";
import { avatar, colourMap, ME_COLOUR } from "../players.js?v=14";
import { formatDistance, formatScore, formatTime, formatDate, ordinal, GAME_TYPES } from "../geo.js?v=14";

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
const solo = game.type === "single_player";
const colours = colourMap(players.map((p) => ({ user_id: p.user_id, joined_at: p.joined_at })), me?.user_id);
const colourOf = (p) => colours.get(p.user_id);
const nameOf = (p) => (p.is_me ? "You" : p.name);
$("#loading").hidden = true;
$("#results-page").hidden = false;

// ---------- The map: every place, numbered, and your guesses ----------
const targets = new Map(rounds.map((r) => [r.number, r]));
drawWorld($("#band"), {
  view: { lat: 18, lng: 12, zoom: 0.05 },
  arcs: (me?.guesses || []).map((g) => ({ from: g, to: targets.get(g.round), colour: ME_COLOUR, width: 2.4 })),
  dots: [...rounds.map((r) => ({ lat: r.lat, lng: r.lng, colour: "#0E1726", r: 4 })), ...(me?.guesses || []).map((g) => ({ lat: g.lat, lng: g.lng, colour: ME_COLOUR, r: 3.6 }))],
});

// ---------- Headline ----------
const winner = players[0];
$("#summary").textContent = `${game.status === "complete" ? "Game over" : "Game so far"} · ${game.map_name} · ${GAME_TYPES[game.type]} · ${formatDate(game.created_at)}`;
$("#headline").textContent = solo || !winner
  ? `You scored ${formatScore(me?.total_score ?? 0)}`
  : winner.is_me ? `You win with ${formatScore(winner.total_score)}` : `${winner.name} wins with ${formatScore(winner.total_score)}`;
if (me && !solo) {
  $("#band-caption").replaceChildren(
    h("div", {}, h("div", { class: "k" }, "You came"), h("div", { class: "v" }, `${ordinal(players.indexOf(me) + 1)} of ${players.length}`)),
    h("div", { class: "score" }, h("b", {}, formatScore(me.total_score)), h("span", {}, "points")));
}
if (game.status === "in_play" || game.status === "lobby") {
  $("#unfinished").replaceChildren("This game is still being played, so only finished rounds are shown. ",
    h("a", { href: gamePageUrl(game, { isHost: game.is_host, isPlayer: Boolean(me) }) }, "Go back to the game"), ".");
  $("#unfinished").hidden = false;
}

// ---------- Your stats: points, distance and time ----------
if (me && me.guesses.length) {
  const n = me.guesses.length;
  const closest = [...me.guesses].sort((a, b) => a.distance_km - b.distance_km)[0];
  const fastest = [...me.guesses].sort((a, b) => a.time_ms - b.time_ms)[0];
  const stat = (k, v, sub) => h("div", { class: "gb-stat" }, h("span", { class: "k" }, k), h("b", {}, v), sub ? h("span", { class: "s" }, sub) : null);
  $("#stats").replaceChildren(
    stat("Points", formatScore(me.total_score), `${formatScore(Math.round(me.total_score / n))} a round`),
    stat("Distance off", `${formatDistance(me.total_distance_km)} km`, `${formatDistance(me.total_distance_km / n)} km a round`),
    stat("Closest", `${formatDistance(closest.distance_km)} km`, `Round ${closest.round} · ${targets.get(closest.round)?.name || ""}`),
    stat("Time", formatTime(me.total_time_ms), `${formatTime(me.total_time_ms / n)} a round · fastest ${formatTime(fastest.time_ms)}`),
  );
  $("#stats").hidden = false;
}

// ---------- Standings (multiplayer) ----------
if (!solo) {
  $("#standings-section").hidden = false;
  $("#standings").replaceChildren(...players.map((p, i) => {
    const byRound = new Map(p.guesses.map((g) => [g.round, g]));
    return h("div", { class: `gb-standing${p.is_me ? " is-me" : ""}`, style: `--c:${colourOf(p)}` },
      h("b", { class: "rank" }, i + 1),
      avatar(p, colourOf(p), 34),
      h("div", { class: "who" },
        h("b", {}, nameOf(p)),
        h("span", {}, `${formatDistance(p.total_distance_km)} km off · ${formatTime(p.total_time_ms)}`),
        h("div", { class: "strip", title: "Points in each round" }, rounds.map((r) => {
          const g = byRound.get(r.number);
          return h("i", { style: `opacity:${g ? (0.2 + 0.8 * g.score / 5000).toFixed(2) : 0.08}` });
        }))),
      h("b", { class: "total" }, formatScore(p.total_score)));
  }));
}

// ---------- Round by round: everyone's distance, time and points ----------
$("#rounds").replaceChildren(...(rounds.length ? rounds.map((r) => {
  const rows = players.map((p) => ({ p, g: p.guesses.find((x) => x.round === r.number) }))
    .sort((a, b) => (a.g?.distance_km ?? Infinity) - (b.g?.distance_km ?? Infinity));
  const best = Math.max(1, ...rows.map(({ g }) => g?.score || 0));
  return h("div", { class: "gb-round" },
    h("div", { class: "gb-round-head" }, h("span", { class: "n" }, r.number), h("b", {}, r.name || `Round ${r.number}`)),
    rows.map(({ p, g }) => h("div", { class: `gb-bar-row${p.is_me ? " is-me-row" : ""}`, style: `--c:${colourOf(p)}` },
      avatar(p, colourOf(p), 28),
      h("div", { class: "who" }, h("b", {}, nameOf(p)), h("span", {}, g ? `${formatDistance(g.distance_km)} km · ${formatTime(g.time_ms)}` : "No guess")),
      h("div", { class: "gb-bar" }, h("i", { style: `width:${g ? Math.max(4, (g.score / best) * 100) : 0}%` })),
      h("span", { class: "pts" }, g ? formatScore(g.score) : "0"))));
}) : [h("p", { class: "gb-muted" }, "No rounds have finished yet.")]));
