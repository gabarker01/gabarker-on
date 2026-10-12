// Pieces shared by the game screens: the live "Guesses this round" list and
// the round results popup with its distance sign (ServiceNow: GeoBarkr
// Results Popup and GeoBarkr Multiplayer Results Popup).
import { $, h, busy } from "./ui.js";
import { createResultsMap, guessLabel } from "./maps.js";
import { formatTime, formatDistance, formatScore } from "./geo.js";

export function renderGuessRows(tbody, guesses) {
  tbody.replaceChildren(...(guesses.length
    ? guesses.map((guess) => h("tr", {}, h("td", {}, guess.name), h("td", { class: "gb-num" }, formatTime(guess.time_ms))))
    : [h("tr", {}, h("td", { colspan: "2", class: "gb-muted" }, "No guesses yet."))]));
}

// Everyone's guess for the round, with their name, km and points on the map.
export function roundGuessesForMap(state, { labels = true } = {}) {
  const target = state.round?.target;
  return state.guesses
    .filter((guess) => guess.lat != null)
    .map((guess) => ({
      lat: guess.lat,
      lng: guess.lng,
      target,
      title: guess.name,
      label: labels ? guessLabel(guess.name, guess.distance_km, guess.score) : null,
    }));
}

// One distance-sign row per player, closest first; players who didn't guess last.
export function signRows(state) {
  const guessed = new Map(state.guesses.filter((g) => g.lat != null).map((g) => [g.user_id, g]));
  const rows = state.players.map((player) => {
    const guess = guessed.get(player.user_id);
    return { name: player.name, distance_km: guess?.distance_km ?? null, score: guess?.score ?? null };
  });
  return rows.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
}

function signRow({ name, distance_km, score }) {
  if (distance_km == null) {
    return h("div", { class: "gb-distance-row is-none" }, h("span", { class: "gb-name" }, name), h("span", {}, "No guess"), h("span", { class: "gb-points" }, "0"));
  }
  return h("div", { class: "gb-distance-row" },
    h("span", { class: "gb-name" }, name),
    h("span", {}, `${formatDistance(distance_km)} km`),
    h("span", { class: "gb-points" }, `+${formatScore(score)}`),
  );
}

export class ResultsPopup {
  constructor(root = $("#results")) {
    this.root = root;
    this.mapPromise = null;
    this.shownFor = null;
  }

  isShowingFor(key) {
    return !this.root.hidden && this.shownFor === key;
  }

  // { key, title, targets, guesses, heading, rows, button: { label, onClick }, wait }
  async open({ key, title, targets, guesses, heading, rows, button, wait }) {
    const root = this.root;
    const fresh = this.shownFor !== key;
    this.shownFor = key;
    $("#results-title", root).textContent = title;

    $("#results-sign", root).replaceChildren(h("h3", {}, heading), ...rows.map(signRow));

    const continueButton = $("#continue", root);
    continueButton.hidden = !button;
    if (button) {
      continueButton.textContent = button.label;
      continueButton.onclick = () => busy(continueButton, button.onClick);
    }
    const waitLine = $("#results-wait", root);
    waitLine.hidden = !wait;
    waitLine.textContent = wait || "";

    root.hidden = false;
    if (fresh) {
      // The one bit of motion: the sign slides up as the round is revealed.
      root.classList.remove("gb-reveal");
      void root.offsetWidth;
      root.classList.add("gb-reveal");
      continueButton.focus({ preventScroll: true });
    }
    if (!this.mapPromise) this.mapPromise = createResultsMap($("#results-map", root));
    try {
      const results = await this.mapPromise;
      if (fresh) results.show({ targets, guesses });
    } catch (error) {
      $("#results-map", root).replaceChildren(h("p", { class: "gb-pano-message" }, error.message));
    }
  }

  close() {
    this.root.hidden = true;
    this.shownFor = null;
  }
}
