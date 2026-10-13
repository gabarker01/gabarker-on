// All-time leaderboard over finished games: total points or best single game.
import { initPage, $, h, showError } from "../ui.js?v=14";
import { leaderboard } from "../api.js?v=14";
import { drawWorld } from "../worldmap.js?v=14";
import { avatar, ME_COLOUR } from "../players.js?v=14";
import { formatScore, ordinal } from "../geo.js?v=14";

await initPage();
drawWorld($("#band"), { view: { lat: 25, lng: 10, zoom: 0.05 } });

const PALETTE = ["#12A57A", "#5B6CFF", "#D49A1E", "#2A93D5", "#D6457F", "#0F8F8F", "#8A5CE6", "#6E9A1C"];
const colourOf = (row, i) => (row.is_me ? ME_COLOUR : PALETTE[i % PALETTE.length]);

async function show(sort) {
  $("#tab-total").setAttribute("aria-selected", String(sort === "total"));
  $("#tab-best").setAttribute("aria-selected", String(sort === "best"));
  try {
    const rows = await leaderboard(sort);
    $("#loading").hidden = true;
    $("#empty").hidden = rows.length > 0;
    const value = (row) => formatScore(sort === "best" ? row.best_game : row.total_score);
    const top = rows.slice(0, 3);
    $("#podium").hidden = top.length < 3;
    if (top.length >= 3) {
      $("#podium").replaceChildren(...[top[1], top[0], top[2]].map((row) => h("div", { class: `gb-pod${row.rank === 1 ? " first" : ""}` },
        h("div", { class: "place" }, ordinal(row.rank)),
        avatar(row, colourOf(row, row.rank - 1), row.rank === 1 ? 46 : 40),
        h("b", {}, value(row)), h("span", { class: "name" }, row.is_me ? `${row.name} (you)` : row.name))));
    }
    $("#rows").replaceChildren(...rows.slice(top.length >= 3 ? 3 : 0).map((row) => h("div", { class: `gb-line${row.is_me ? " is-me" : ""}` },
      h("span", { class: "gb-muted num", style: "width:26px" }, row.rank),
      avatar(row, colourOf(row, row.rank - 1), 30),
      h("div", { class: "grow" }, h("b", {}, row.is_me ? `${row.name} (you)` : row.name), h("span", {}, `${row.games} game${row.games === 1 ? "" : "s"} · average ${formatScore(row.average_game)}`)),
      h("div", { class: "end" }, h("b", {}, value(row))))));
  } catch (error) {
    $("#loading").textContent = "Couldn't load the leaderboard. Refresh the page to try again.";
    showError(error);
  }
}

$("#tab-total").addEventListener("click", () => show("total"));
$("#tab-best").addEventListener("click", () => show("best"));
show("total");
