// Pieces shared by the game screens: the live "Guesses this round" list and
// the round results popup (ServiceNow: GeoBarkr Results Popup and
// GeoBarkr Multiplayer Results Popup).
import { $, h, busy } from "./ui.js";
import { createResultsMap, guessLabel } from "./maps.js";
import { formatTime } from "./geo.js";

export function renderGuessRows(tbody, guesses) {
  tbody.replaceChildren(...(guesses.length
    ? guesses.map((guess) => h("tr", {}, h("td", { class: "gb-left" }, guess.name), h("td", {}, formatTime(guess.time_ms))))
    : [h("tr", {}, h("td", { colspan: "2", class: "gb-muted" }, "No guesses yet"))]));
}

// Everyone's guess for the round, with their name, km and points.
export function roundGuessesForMap(state) {
  const target = state.round?.target;
  return state.guesses
    .filter((guess) => guess.lat != null)
    .map((guess) => ({
      lat: guess.lat,
      lng: guess.lng,
      target,
      title: guess.name,
      label: guessLabel(guess.name, guess.distance_km, guess.score),
    }));
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

  // { key, title, targets, guesses, points, text, button: { label, onClick }, wait }
  async open({ key, title, targets, guesses, points, text, button, wait }) {
    const root = this.root;
    this.shownFor = key;
    $("#results-title", root).textContent = title || "";
    $("#results-title", root).hidden = !title;

    const pointsLine = $("#results-points", root);
    pointsLine.hidden = points == null;
    pointsLine.textContent = points == null ? "" : `+${points.toLocaleString("en-GB")} points`;

    const textLine = $("#results-text", root);
    textLine.hidden = !text;
    textLine.textContent = text || "";

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
    if (!this.mapPromise) this.mapPromise = createResultsMap($("#results-map", root));
    try {
      const results = await this.mapPromise;
      results.show({ targets, guesses });
    } catch (error) {
      $("#results-map", root).replaceChildren(h("p", { class: "gb-loading" }, error.message));
    }
  }

  close() {
    this.root.hidden = true;
    this.shownFor = null;
  }
}
