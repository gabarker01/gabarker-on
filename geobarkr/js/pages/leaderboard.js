// All-time leaderboard over finished games: total points or best single game.
import { initPage, $, h, showError } from "../ui.js";
import { leaderboard } from "../api.js";
import { formatScore } from "../geo.js";

await initPage();

async function show(sort) {
  $("#tab-total").setAttribute("aria-selected", String(sort === "total"));
  $("#tab-best").setAttribute("aria-selected", String(sort === "best"));
  try {
    const rows = await leaderboard(sort);
    $("#loading").hidden = true;
    $("#empty").hidden = rows.length > 0;
    $("#board").hidden = rows.length === 0;
    $("#board").replaceChildren(
      h("thead", {}, h("tr", {},
        h("th", { class: "gb-num" }, "Place"), h("th", {}, "Player"),
        h("th", { class: "gb-num" }, sort === "best" ? "Best game" : "Total points"),
        h("th", { class: "gb-num" }, sort === "best" ? "Total points" : "Best game"),
        h("th", { class: "gb-num" }, "Games"), h("th", { class: "gb-num" }, "Average"))),
      h("tbody", {}, rows.map((row) => h("tr", { class: row.is_me ? "is-me" : false },
        h("td", { class: "gb-num" }, row.rank),
        h("td", { class: "gb-strong" }, row.name),
        h("td", { class: "gb-num gb-strong" }, formatScore(sort === "best" ? row.best_game : row.total_score)),
        h("td", { class: "gb-num" }, formatScore(sort === "best" ? row.total_score : row.best_game)),
        h("td", { class: "gb-num" }, row.games),
        h("td", { class: "gb-num" }, formatScore(row.average_game)),
      ))),
    );
  } catch (error) {
    $("#loading").textContent = "Couldn't load the leaderboard. Refresh the page to try again.";
    showError(error);
  }
}

$("#tab-total").addEventListener("click", () => show("total"));
$("#tab-best").addEventListener("click", () => show("best"));
show("total");
