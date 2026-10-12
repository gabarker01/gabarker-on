// My games: every game you've played or hosted, newest first, plus your name.
import { initPage, $, h, busy, toast, showError } from "../ui.js";
import { myGames, renameMe, gamePageUrl } from "../api.js";
import { GAME_TYPES, formatDate, formatScore, ordinal } from "../geo.js";

const { session, profile } = await initPage();

$("#name").value = profile?.display_name || "";
$("#name-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#name").value.trim();
  if (!name) return;
  busy($("#name-button"), async () => {
    await renameMe(session.user.id, name);
    toast("Name saved.");
    const menuName = document.querySelector(".gb-menu-name");
    if (menuName) menuName.textContent = name;
  });
});

const STATUS_TEXT = { lobby: "In the lobby", in_play: "Still playing", cancelled: "Cancelled" };

try {
  const games = await myGames();
  $("#loading").hidden = true;
  if (!games.length) {
    $("#empty").hidden = false;
  } else {
    $("#games").hidden = false;
    $("#games").replaceChildren(
      h("thead", {}, h("tr", {}, h("th", {}, "Game"), h("th", { class: "gb-num" }, "Score"), h("th", { class: "gb-num" }, "Place"))),
      h("tbody", {}, games.map((game) => {
        const url = gamePageUrl(game, { isHost: game.is_host, isPlayer: game.my_score != null });
        const what = `${GAME_TYPES[game.type]} on ${game.map_name}`;
        return h("tr", {},
          h("td", {},
            h("a", { href: url, class: "gb-strong" }, what),
            h("span", { class: "gb-meta" }, [formatDate(game.created_at), STATUS_TEXT[game.status], game.is_host && game.type === "local_multiplayer" ? "You hosted" : null].filter(Boolean).join(", "))),
          h("td", { class: "gb-num" }, game.my_score == null ? "" : formatScore(game.my_score)),
          h("td", { class: "gb-num" }, game.my_rank == null || game.type === "single_player" ? "" : `${ordinal(game.my_rank)} of ${game.player_count}`),
        );
      })),
    );
  }
} catch (error) {
  $("#loading").textContent = "Couldn't load your games. Refresh the page to try again.";
  showError(error);
}
