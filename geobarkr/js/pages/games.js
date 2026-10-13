// My games: every place you've been dropped on one map, then each game with a
// small map of its places and your guesses. Also your display name.
import { initPage, $, h, busy, toast, showError } from "../ui.js";
import { myGames, renameMe, gamePageUrl } from "../api.js";
import { drawWorld } from "../worldmap.js";
import { ME_COLOUR } from "../players.js";
import { GAME_TYPES, formatDate, formatScore, ordinal } from "../geo.js";

const { profile } = await initPage();

$("#name").value = profile?.display_name || "";
$("#name-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#name").value.trim();
  if (!name) return;
  busy($("#name-button"), async () => {
    await renameMe(name);
    toast("Name saved.");
  });
});

const STATUS = { lobby: "In the lobby", in_play: "Still playing", cancelled: "Cancelled" };
const arcsOf = (places) => places.filter((p) => p.guess_lat != null).map((p) => ({ from: { lat: p.guess_lat, lng: p.guess_lng }, to: p, colour: ME_COLOUR, width: 1.6 }));
const dotsOf = (places, r) => places.map((p) => ({ lat: p.lat, lng: p.lng, colour: "#0E1726", r }));

try {
  const games = await myGames();
  $("#loading").hidden = true;
  const all = games.flatMap((g) => g.places || []);
  drawWorld($("#band"), { view: { lat: 18, lng: 12, zoom: 0.05 }, dots: dotsOf(all, 3.4) });
  const total = games.reduce((sum, g) => sum + (g.my_score || 0), 0);
  $("#band-caption").replaceChildren(
    h("div", {}, h("div", { class: "k" }, "Places you've been dropped"), h("div", { class: "v" }, `${all.length} place${all.length === 1 ? "" : "s"}, ${games.length} game${games.length === 1 ? "" : "s"}`)),
    h("div", { class: "score" }, h("b", {}, formatScore(total)), h("span", {}, "points in all")),
  );
  if (!games.length) {
    $("#empty").hidden = false;
  } else {
    $("#games").hidden = false;
    $("#games").replaceChildren(...games.map((game) => {
      const thumb = h("div", { class: "gb-thumb" });
      const url = gamePageUrl(game, { isHost: game.is_host, isPlayer: game.my_score != null });
      const row = h("a", { class: "gb-line", href: url, style: "color:inherit;text-decoration:none" },
        thumb,
        h("div", { class: "grow" },
          h("b", {}, game.map_name),
          h("span", {}, [GAME_TYPES[game.type], formatDate(game.created_at), STATUS[game.status]].filter(Boolean).join(" · "))),
        h("div", { class: "end" },
          h("b", {}, game.my_score == null ? "Host" : formatScore(game.my_score)),
          h("span", {}, game.my_rank == null || game.type === "single_player" ? "" : `${ordinal(game.my_rank)} of ${game.player_count}`)));
      requestAnimationFrame(() => drawWorld(thumb, { view: { lat: 15, lng: 10, zoom: 0 }, grid: false, arcs: arcsOf(game.places || []), dots: dotsOf(game.places || [], 2) }));
      return row;
    }));
  }
} catch (error) {
  $("#loading").textContent = "Couldn't load your games. Refresh the page to try again.";
  showError(error);
}
