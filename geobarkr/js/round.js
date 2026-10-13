// Shared by the game screens: the live "Guesses this round" list, and the
// round results panel (map with everyone's pins and great-circle lines, then
// a ranked list).
import { $, h, busy, markNew } from "./ui.js?v=12";
import { countUp, replay } from "./motion.js?v=12";
import { createResultsMap } from "./maps.js?v=12";
import { avatar, colourMap } from "./players.js?v=12";
import { formatTime, formatDistance, formatScore, ordinal } from "./geo.js?v=12";
import { nextRound, resultsUrl } from "./api.js?v=12";

// The host's Next round / See results button.
export async function nextRoundOrResults(gameId, watcher) {
  const result = await nextRound(gameId);
  if (result === "complete") location.replace(resultsUrl(gameId));
  else watcher.refresh();
}

export function coloursFor(state) {
  return colourMap(state.players, state.me.user_id);
}

const playerOf = (state, userId) => state.players.find((p) => p.user_id === userId) || { name: "Player" };

export function renderGuessList(container, state) {
  const colours = coloursFor(state);
  container.replaceChildren(...(state.guesses.length
    ? state.guesses.map((guess) => h("div", { class: "gb-line", "data-key": `${state.round?.number}:${guess.user_id}` },
        avatar(playerOf(state, guess.user_id), colours.get(guess.user_id), 30),
        h("div", { class: "grow" }, h("b", {}, guess.user_id === state.me.user_id ? `${guess.name} (you)` : guess.name)),
        h("div", { class: "end" }, h("span", {}, formatTime(guess.time_ms)))))
    : [h("p", { class: "gb-muted" }, "No guesses yet.")]));
  markNew(container);
}

export class ResultsPanel {
  constructor(root = $("#results")) {
    this.root = root;
    this.mapPromise = null;
    this.shownFor = null;
  }

  close() {
    this.root.hidden = true;
    this.shownFor = null;
  }

  // { key, title, state, button: { label, onClick }, wait }
  async open({ key, title, state, button, wait }) {
    const root = this.root;
    const fresh = this.shownFor !== key;
    this.shownFor = key;
    const colours = coloursFor(state);
    const meId = state.me.user_id;
    const target = state.round.target;
    const guessed = new Map(state.guesses.filter((g) => g.lat != null).map((g) => [g.user_id, g]));

    $("#results-title", root).textContent = title;
    $("#results-place", root).textContent = state.round.place || "";

    // Summary: how far you were, or (for a host who isn't playing) the closest.
    const mine = guessed.get(meId);
    const closest = [...guessed.values()].sort((a, b) => a.distance_km - b.distance_km)[0];
    const summary = $("#results-summary", root);
    // Leave the summary alone while its reveal is still counting up.
    if (fresh) this.countingUntil = performance.now() + 700;
    if (!fresh && performance.now() < (this.countingUntil || 0)) {
      // same round, numbers already on their way
    } else if (state.me.is_player) {
      const km = h("span", { class: "km" }, mine ? `${formatDistance(mine.distance_km)} km away` : "0 points");
      const pts = mine ? h("span", { class: "pts" }, `+${formatScore(mine.score)}`) : null;
      const place = guessed.size > 1 && mine ? [...guessed.values()].sort((a, b) => b.score - a.score).findIndex((g) => g.user_id === meId) + 1 : 0;
      summary.replaceChildren(
        h("div", { class: "k" }, mine ? "You were" : "You didn't guess this round"),
        h("div", { class: "row" }, km, pts),
        mine ? h("div", { class: "meta" }, [`Guessed in ${formatTime(mine.time_ms)}`, place ? `${ordinal(place)} of ${guessed.size} this round` : null].filter(Boolean).join(" · ")) : null);
      // The reveal: your distance and points count up as the sheet arrives.
      if (fresh && mine) {
        countUp(km, mine.distance_km, (v) => `${formatDistance(v)} km away`);
        countUp(pts, mine.score, (v) => `+${formatScore(Math.round(v))}`);
      }
    } else if (closest) {
      summary.replaceChildren(
        h("div", { class: "k" }, "Closest"),
        h("div", { class: "row" }, h("span", { class: "km" }, closest.name), h("span", { class: "pts" }, `${formatDistance(closest.distance_km)} km`)));
    } else {
      summary.replaceChildren(h("div", { class: "k" }, "Nobody guessed this round"));
    }

    // Everyone, best score first (closest), anyone who didn't guess at the
    // bottom: distance and time under the name, a bar for the points.
    const rows = state.players.map((p) => ({ p, g: guessed.get(p.user_id) }))
      .sort((a, b) => (a.g?.distance_km ?? Infinity) - (b.g?.distance_km ?? Infinity));
    const best = Math.max(1, ...[...guessed.values()].map((g) => g.score));
    $("#results-ranked", root).replaceChildren(...(state.players.length > 1 ? rows.map(({ p, g }) => h("div", { class: `gb-bar-row${p.user_id === meId ? " is-me" : ""}`, style: `--c:${colours.get(p.user_id)}` },
      avatar(p, colours.get(p.user_id), 28),
      h("div", { class: "who" }, h("b", {}, p.name), h("span", {}, g ? `${formatDistance(g.distance_km)} km · ${formatTime(g.time_ms)}` : "No guess")),
      h("div", { class: "gb-bar" }, h("i", { style: `width:${g ? Math.max(4, (g.score / best) * 100) : 0}%` })),
      h("span", { class: "pts" }, g ? formatScore(g.score) : "0"))) : []));

    const go = $("#continue", root);
    go.hidden = !button;
    if (button) {
      go.textContent = button.label;
      go.onclick = () => busy(go, button.onClick);
    }
    const waitLine = $("#results-wait", root);
    waitLine.hidden = !wait;
    waitLine.textContent = wait || "";

    root.hidden = false;
    if (fresh) {
      replay(root, "is-new");
      try {
        this.mapPromise ||= createResultsMap($("#results-map", root));
        const map = await this.mapPromise;
        const info = $(".gb-results-info", root).getBoundingClientRect();
        const wide = window.innerWidth >= 900;
        map.show({
          inset: wide ? { top: 90, right: info.width + 50, bottom: 40, left: 40 } : { top: 80, bottom: info.height + 30 },
          targets: target ? [{ ...target, place: state.round.place }] : [],
          guesses: [...guessed.values()].map((g) => ({
            lat: g.lat, lng: g.lng, target, player: playerOf(state, g.user_id), colour: colours.get(g.user_id), me: g.user_id === meId,
          })),
        });
      } catch (error) {
        $("#results-map", root).replaceChildren(h("p", { class: "gb-pano-msg" }, error.message));
      }
    }
  }
}
