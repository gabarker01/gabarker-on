// Admin (ServiceNow: the GeoBarkr application menu): maps and their locations,
// with a Street View preview to set each round's starting view, and recent
// games. Row-level security also enforces admin-only access.
import { initPage, $, h, busy, toast, showError, kindIcon } from "../ui.js?v=13";
import { adminMaps, saveMap, deleteMap, mapLocations, saveLocation, deleteLocation, recentGames, resultsUrl } from "../api.js?v=13";
import { createPanorama } from "../maps.js?v=13";
import { GAME_TYPES, GAME_STATUSES, formatDate, parseStreetViewLink } from "../geo.js?v=13";

const { profile } = await initPage();
const isAdmin = profile?.role === "admin";
$("#denied").hidden = isAdmin;
$("#admin").hidden = !isAdmin;

let selectedMap = null;
let editingId = null;
let panoPromise = null;

// ---------- Maps ----------

async function loadMaps() {
  const maps = await adminMaps();
  $("#maps").replaceChildren(...maps.map((map) => {
    const name = h("input", { class: "gb-input", value: map.name, maxlength: "80", "aria-label": "Map name" });
    name.addEventListener("change", () => busy(null, async () => {
      await saveMap({ id: map.id, name: name.value.trim(), active: map.active });
      map.name = name.value.trim();
      toast("Map renamed.");
    }));
    const byPlayer = Boolean(map.owner_id);
    const active = h("input", { type: "checkbox", checked: map.active, "aria-label": `${map.name} is active` });
    active.addEventListener("change", () => busy(null, async () => {
      map.active = active.checked;
      await saveMap({ id: map.id, name: map.name, active: active.checked });
      toast(active.checked ? "Map is now active." : "Map is now hidden from players.");
    }));
    // A player's map: block or allow it (its owner can't undo a block).
    const allowed = h("input", { type: "checkbox", checked: !map.blocked, "aria-label": `${map.name} is allowed` });
    allowed.addEventListener("change", () => busy(null, async () => {
      map.blocked = !allowed.checked;
      await saveMap({ id: map.id, name: map.name, active: map.active, blocked: map.blocked });
      toast(map.blocked ? "Map blocked: nobody can start a game on it." : "Map allowed again.");
    }));
    // Players' own maps: admins can block them; only their owner edits or
    // deletes them (on the map maker page).
    return h("div", { class: `gb-line${selectedMap?.id === map.id ? " is-me" : ""}` },
      kindIcon(map.kind),
      h("div", { class: "grow" }, byPlayer ? h("b", {}, map.name) : name,
        byPlayer ? h("span", {}, `By ${map.owner_name}${map.is_public ? "" : " · private"}`) : null),
      byPlayer ? h("label", { class: "gb-check" }, allowed, "Allowed") : h("label", { class: "gb-check" }, active, "Active"),
      byPlayer ? null : h("button", { type: "button", class: "gb-btn quiet small", onclick: () => selectMap(map) }, "Locations"),
      byPlayer ? null : h("button", { type: "button", class: "gb-btn danger small", onclick: (event) => removeMap(map, event.currentTarget) }, "Delete"));
  }));
}

function removeMap(map, button) {
  if (!confirm(`Delete the map "${map.name}" and all its locations? Games already played keep their rounds.`)) return;
  busy(button, async () => {
    await deleteMap(map.id);
    if (selectedMap?.id === map.id) {
      selectedMap = null;
      $("#locations-section").hidden = true;
      $("#editor-section").hidden = true;
    }
    toast("Map deleted.");
    await loadMaps();
  });
}

$("#new-map").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  busy(form.querySelector("button"), async () => {
    const map = await saveMap({ name: form.name.value.trim(), active: false });
    form.reset();
    toast("Map added. Add its locations, then make it active.");
    await loadMaps();
    if (map) selectMap(map);
  });
});

// ---------- Locations ----------

async function selectMap(map) {
  selectedMap = map;
  $("#locations-section").hidden = false;
  $("#locations-title").textContent = `Locations on ${map.name}`;
  await Promise.all([loadMaps(), loadLocations()]);
  openEditor(null);
}

async function loadLocations() {
  const locations = await mapLocations(selectedMap.id);
  $("#locations").replaceChildren(...(locations.length ? locations.map((location) => h("div", { class: "gb-line" },
    h("span", { class: "gb-muted num", style: "width:20px" }, location.round_number),
    h("div", { class: "grow" }, h("b", {}, location.name), h("span", {}, `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`)),
    h("button", { type: "button", class: "gb-btn quiet small", onclick: () => openEditor(location) }, "Edit"),
    h("button", { type: "button", class: "gb-btn danger small", onclick: (event) => removeLocation(location, event.currentTarget) }, "Delete")))
    : [h("p", { class: "gb-muted" }, "No locations yet. Add one below.")]));
}

function removeLocation(location, button) {
  if (!confirm(`Delete "${location.name}"?`)) return;
  busy(button, async () => {
    await deleteLocation(location.id);
    toast("Location deleted.");
    await loadLocations();
  });
}

function openEditor(location) {
  editingId = location?.id || null;
  const form = $("#editor");
  form.reset();
  $("#editor-section").hidden = false;
  $("#editor-title").textContent = location ? `Edit ${location.name}` : `Add a location to ${selectedMap.name}`;
  if (location) {
    for (const key of ["name", "round_number", "lat", "lng", "heading", "pitch"]) form[key].value = location[key];
    preview();
  }
}
$("#cancel-edit").addEventListener("click", () => openEditor(null));

$("#paste").addEventListener("input", () => {
  const view = parseStreetViewLink($("#paste").value);
  if (!view) return;
  const form = $("#editor");
  for (const [key, value] of Object.entries(view)) form[key].value = Number(value.toFixed(6));
  preview();
});

function readForm() {
  const form = $("#editor");
  return {
    name: form.name.value.trim(), round_number: Number(form.round_number.value),
    lat: Number(form.lat.value), lng: Number(form.lng.value),
    heading: Number(form.heading.value) % 360, pitch: Number(form.pitch.value),
  };
}

function preview() {
  const view = readForm();
  if ($("#editor").lat.value === "" || !Number.isFinite(view.lat) || !Number.isFinite(view.lng)) return;
  if (!panoPromise) {
    panoPromise = createPanorama($("#admin-pano"));
    panoPromise.catch((error) => $("#admin-pano").replaceChildren(h("p", { class: "gb-pano-msg" }, error.message)));
  }
  panoPromise.then((pano) => { pano.hide(); pano.show(view); }).catch(() => {});
}
$("#preview").addEventListener("click", preview);

$("#use-view").addEventListener("click", async () => {
  if (!panoPromise) return toast("Preview a place first.");
  const { panorama } = await panoPromise;
  if (!panorama) return toast("Copying the view needs the Google Maps key. Type the angles in, or paste a Street View link.");
  const position = panorama.getPosition();
  if (!position) return toast("Preview a place first.");
  const pov = panorama.getPov();
  const form = $("#editor");
  form.lat.value = Number(position.lat().toFixed(6));
  form.lng.value = Number(position.lng().toFixed(6));
  form.heading.value = Number((((pov.heading % 360) + 360) % 360).toFixed(2));
  form.pitch.value = Number(pov.pitch.toFixed(2));
  return toast("View copied into the form. Save to keep it.");
});

$("#editor").addEventListener("submit", (event) => {
  event.preventDefault();
  busy($("#save-location"), async () => {
    const row = readForm();
    await saveLocation(editingId ? { id: editingId, ...row } : { ...row, map_id: selectedMap.id });
    toast(editingId ? "Location saved." : "Location added.");
    openEditor(null);
    await loadLocations();
  });
});

// ---------- Games ----------

async function loadGames() {
  const games = await recentGames();
  $("#games").replaceChildren(...(games.length ? games.map((game) => h("a", { class: "gb-line", href: resultsUrl(game.id), style: "color:inherit" },
    h("div", { class: "grow" }, h("b", {}, `${GAME_TYPES[game.type]} on ${game.map_name}`), h("span", {}, `${formatDate(game.created_at)} · code ${game.code} · host ${game.host_name}`)),
    h("div", { class: "end" }, h("span", {}, GAME_STATUSES[game.status]))))
    : [h("p", { class: "gb-muted" }, "No games yet.")]));
}

if (isAdmin) Promise.all([loadMaps(), loadGames()]).catch(showError);
