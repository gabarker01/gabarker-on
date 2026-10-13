// The bar above Street View: home link, round number with progress, your total.
import { $, logoMark, helpButton } from "./ui.js?v=11";
import { formatScore } from "./geo.js?v=11";

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

// A compass over Street View, turning as you look around (N always points
// north). Hidden where the heading isn't known (the keyless embed).
export function setupCompass(panoPromise, container) {
  const el = document.createElement("div");
  el.className = "gb-compass";
  el.hidden = true;
  el.setAttribute("role", "img");
  el.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><g class="dial">'
    + '<path d="M24 7l4.2 17h-8.4z" fill="var(--me)"/><path d="M24 41l-4.2-17h8.4z" fill="currentColor" opacity=".35"/>'
    + '<text x="24" y="6.6" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor">N</text>'
    + '<circle cx="24" cy="24" r="2.4" fill="currentColor"/></g></svg>';
  container.append(el);
  const dial = el.querySelector(".dial");
  const show = (heading) => {
    dial.style.transform = `rotate(${-heading}deg)`;
    el.setAttribute("aria-label", `Facing ${Math.round(((heading % 360) + 360) % 360)}° from north`);
  };
  panoPromise.then((pano) => {
    if (!pano.onHeading?.(show)) return;
    el.hidden = false;
    show(pano.panorama?.getPov?.().heading || 0);
  }).catch(() => {});
}
