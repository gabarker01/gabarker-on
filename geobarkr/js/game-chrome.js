// The bar above Street View: home link, round number with progress, your total.
import { $, logoMark, helpButton } from "./ui.js";
import { formatScore } from "./geo.js";

export function setupTopbar() {
  $("#home-link").append(logoMark(22));
  document.querySelector(".gb-topbar")?.append(helpButton());
}

export function renderTopbar(state, { showScore = true } = {}) {
  const { game, round, players, me } = state;
  const number = round?.number ?? game.round_count;
  $("#round-label").textContent = round?.status === "results" ? `Round ${number} results` : `Round ${number}`;
  const steps = $("#steps");
  steps.replaceChildren(...Array.from({ length: game.round_count }, (_, i) => {
    const step = document.createElement("i");
    if (i + 1 < number || (i + 1 === number && round?.status === "results")) step.className = "done";
    else if (i + 1 === number) step.className = "now";
    return step;
  }));
  const mine = players.find((p) => p.user_id === me.user_id);
  const score = $("#score");
  if (showScore && mine) {
    score.replaceChildren(document.createElement("b"), " pts");
    score.firstChild.textContent = formatScore(mine.total_score);
  } else {
    score.textContent = game.code && game.type !== "single_player" ? `Code ${game.code}` : "";
  }
  document.title = `Round ${number} · GeoBarkr`;
}
