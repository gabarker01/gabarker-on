// Your profile (tap your picture in the header): your numbers over every
// finished game, the maps you've made (and a button to make one), your name,
// the other pages and Sign out.
import { initPage, $, h, busy, toast, showError, pageReady, sheetDialog, closeButton, kindIcon, KIND_NAMES, chevron, signOutAndLeave } from "../ui.js?v=13";
import { myStats, myMaps, myGames, renameMe, photoUrl } from "../api.js?v=13";
import { drawWorld } from "../worldmap.js?v=13";
import { avatar, ME_COLOUR } from "../players.js?v=13";
import { formatScore, formatDistance, formatTime, ordinal } from "../geo.js?v=13";
import { countUp } from "../motion.js?v=13";

const { profile } = await initPage({ hold: true });

const name = () => profile?.display_name || "You";
function showName() {
  $("#me-name").textContent = name();
  $("#name-value").textContent = name();
  $("#me-avatar").replaceChildren(avatar({ name: name(), avatar_url: profile?.avatar_url }, ME_COLOUR, 76));
  document.title = `${name()} · GeoBarkr`;
}
showName();
$("#admin-row").hidden = profile?.role !== "admin";
$("#sign-out").addEventListener("click", (event) => busy(event.currentTarget, signOutAndLeave));

// ---------- Name ----------
const sheet = $("#name-sheet");
const closeSheet = sheetDialog(sheet);
$("#name-close").replaceWith(closeButton(closeSheet));
$("#name-row").addEventListener("click", () => {
  $("#name").value = name();
  sheet.showModal();
});
$("#name-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = $("#name").value.trim();
  if (!value) return;
  busy($("#name-button"), async () => {
    await renameMe(value);
    if (profile) profile.display_name = value;
    showName();
    closeSheet();
    toast("Name saved.");
  });
});

// ---------- Numbers ----------
const km = (value) => (value == null ? "–" : `${formatDistance(value)} km`);
function tile(label, value, sub, { count = null } = {}) {
  const b = h("b", {}, value);
  if (count != null && count > 0) countUp(b, count, formatScore, 800);
  return h("div", { class: "gb-stat" }, h("span", { class: "k" }, label), b, h("span", { class: "s" }, sub || " "));
}
function renderStats(s) {
  const played = s.games > 0;
  $("#stats").replaceChildren(
    tile("Games", String(s.games), played ? [s.solo_games && `${s.solo_games} solo`, s.group_games && `${s.group_games} with others`].filter(Boolean).join(" · ") : "Finish a game to start"),
    tile("Points", formatScore(s.total_score), played ? `Best game ${formatScore(s.best_game)}` : null, { count: s.total_score }),
    tile("Average game", played ? formatScore(s.average_game) : "–", played ? "out of 25,000" : null),
    tile("Wins", String(s.wins), s.group_games ? `of ${s.group_games} with others` : "Play with friends"),
    tile("Average distance", km(s.average_km), s.rounds ? `over ${s.rounds} round${s.rounds === 1 ? "" : "s"}` : null),
    tile("Closest", km(s.closest_km), s.closest_place || null),
    tile("Average time", s.average_time_ms == null ? "–" : formatTime(s.average_time_ms), s.fastest_ms == null ? null : `Fastest ${formatTime(s.fastest_ms)}`),
    tile("Perfect rounds", String(s.perfect_rounds), "within 10 metres"),
  );
  $("#rank-value").textContent = s.rank ? `${ordinal(s.rank)} of ${s.players}` : "";
  $("#me-sub").textContent = [
    played ? `${s.games} game${s.games === 1 ? "" : "s"}` : "No finished games yet",
    s.rank ? `${ordinal(s.rank)} all time` : null,
    s.maps_made ? `${s.maps_made} map${s.maps_made === 1 ? "" : "s"} made` : null,
  ].filter(Boolean).join(" · ");
}

// ---------- Your maps ----------
function mapCard(map, i) {
  const thumb = h("span", { class: "gb-card-thumb" });
  if (map.kind === "photo" && map.cover_path) {
    thumb.append(h("img", { src: photoUrl(map.cover_path), alt: "", loading: "lazy" }));
  } else {
    requestAnimationFrame(() => drawWorld(thumb, {
      view: { lat: 20, lng: 10, zoom: 0 }, grid: false,
      dots: (map.places || []).map((p) => ({ lat: p.lat, lng: p.lng, colour: ME_COLOUR, r: 3, stroke: "#fff", strokeWidth: 1.2 })),
    }));
  }
  const ready = map.rounds === 5;
  const state = map.blocked ? h("span", { class: "gb-state is-off" }, "Blocked by an admin")
    : !ready ? h("span", { class: "gb-state is-draft" }, `${map.rounds} of 5 places`)
    : !map.active ? h("span", { class: "gb-state is-off" }, "Switched off")
      : h("span", { class: "gb-state is-ready" }, map.is_public ? "Public" : "Private");
  return h("a", { class: "gb-card", href: `/geobarkr/map/?id=${encodeURIComponent(map.id)}`, style: `--i:${Math.min(i, 10)}` },
    thumb,
    h("span", { class: "gb-card-body" },
      h("b", {}, map.name),
      h("span", { class: "meta" }, kindIcon(map.kind), KIND_NAMES[map.kind], map.plays ? ` · played ${map.plays} time${map.plays === 1 ? "" : "s"}` : ""),
      state),
    chevron());
}

// Your places on the band, as on the start screen.
async function drawBand() {
  let games = [];
  try { games = await myGames(); } catch { /* the map still draws */ }
  const seen = new Map();
  for (const g of games) for (const p of g.places || []) seen.set(`${p.lat.toFixed(3)},${p.lng.toFixed(3)}`, p);
  $("#games-value").textContent = games.length ? String(games.length) : "";
  await drawWorld($("#band"), {
    view: { lat: 22, lng: 10, zoom: 0.05 },
    dots: [...seen.values()].map((p) => ({ lat: p.lat, lng: p.lng, colour: ME_COLOUR, r: 3.6, stroke: "#fff", strokeWidth: 1.6 })),
  });
}

const loaded = Promise.allSettled([
  myStats().then(renderStats),
  myMaps().then((maps) => {
    $("#maps").replaceChildren(...maps.map(mapCard));
    $("#maps-empty").hidden = maps.length > 0;
  }),
  drawBand(),
]).then((results) => {
  const failed = results.find((r) => r.status === "rejected");
  if (failed) showError(failed.reason);
});
await Promise.race([loaded, new Promise((done) => setTimeout(done, 2500))]);
pageReady();
