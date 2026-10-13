// All-time leaderboard over finished games: total points or best single game.
import { initPage, $, h, showError } from "../ui.js";
import { leaderboard } from "../api.js";
import { drawWorld } from "../worldmap.js";
import { avatar, ME_COLOUR } from "../players.js";
import { formatScore, ordinal } from "../geo.js";

await initPage();
drawWorld($("#band"), { view: { lat: 25, lng: 10, zoom: 0.05 } });

const PALETTE = ["#6EE7B7", "#B9A6FF", "#F2CF5B", "#5DB0FF", "#F28B82", "#7FD8BE", "#E5A1FF", "#A3E635"];
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
