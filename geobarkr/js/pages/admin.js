// Admin (ServiceNow: the GeoBarkr application menu): maps and their
// locations, with a Street View preview to set each round's starting view,
// and recent games. Row-level security also enforces admin-only access.
import { initPage, $, h, busy, toast, showError } from "../ui.js";
import { getClient } from "../supabase.js";
import { createPanorama } from "../maps.js";
import { GAME_TYPES, GAME_STATUSES, formatDate, parseStreetViewLink } from "../geo.js";

const { profile } = await initPage();
const isAdmin = profile?.role === "admin";
$("#denied").hidden = isAdmin;
$("#admin").hidden = !isAdmin;

const client = await getClient();
const db = async (query) => {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
};

let selectedMap = null;
let editingId = null;
let panoPromise = null;

// ---------- Maps ----------

async function loadMaps() {
  const maps = await db(client.from("maps").select("id, name, active").order("name"));
  $("#maps").replaceChildren(
    h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Active"), h("th", {}, ""))),
    h("tbody", {}, maps.map((map) => {
      const name = h("input", { class: "gb-input", value: map.name, maxlength: "80", "aria-label": "Map name" });
      name.addEventListener("change", () => busy(null, async () => {
        await db(client.from("maps").update({ name: name.value.trim() }).eq("id", map.id));
        toast("Map renamed.");
      }));
      const active = h("input", { type: "checkbox", checked: map.active, "aria-label": `${map.name} is active` });
      active.addEventListener("change", () => busy(null, async () => {
        await db(client.from("maps").update({ active: active.checked }).eq("id", map.id));
        toast(active.checked ? "Map is now active." : "Map is now hidden from players.");
      }));
      return h("tr", { class: selectedMap?.id === map.id ? "is-me" : false },
        h("td", {}, name),
        h("td", {}, h("label", { class: "gb-check" }, active)),
        h("td", { class: "gb-num" },
          h("button", { type: "button", class: "gb-button gb-button-quiet", onclick: () => selectMap(map) }, "Locations"), " ",
          h("button", { type: "button", class: "gb-button gb-button-quiet", onclick: (event) => deleteMap(map, event.currentTarget) }, "Delete")),
      );
    })),
  );
}

function deleteMap(map, button) {
  if (!confirm(`Delete the map "${map.name}" and all its locations? Games already played keep their rounds.`)) return;
  busy(button, async () => {
    await db(client.from("maps").delete().eq("id", map.id));
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
    const [map] = await db(client.from("maps").insert({ name: form.name.value.trim(), active: false }).select("id, name, active"));
    form.reset();
    toast("Map added. Add its locations, then make it active.");
    await loadMaps();
    selectMap(map);
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
  const locations = await db(client.from("locations")
    .select("id, name, round_number, lat, lng, heading, pitch").eq("map_id", selectedMap.id).order("round_number"));
  $("#locations").replaceChildren(
    h("thead", {}, h("tr", {}, h("th", { class: "gb-num" }, "Round"), h("th", {}, "Name"), h("th", {}, ""))),
    h("tbody", {}, locations.length ? locations.map((location) => h("tr", {},
      h("td", { class: "gb-num" }, location.round_number),
      h("td", {}, h("span", { class: "gb-strong" }, location.name),
        h("span", { class: "gb-meta" }, `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`)),
      h("td", { class: "gb-num" },
        h("button", { type: "button", class: "gb-button gb-button-quiet", onclick: () => openEditor(location) }, "Edit"), " ",
        h("button", { type: "button", class: "gb-button gb-button-quiet", onclick: (event) => deleteLocation(location, event.currentTarget) }, "Delete")),
    )) : [h("tr", {}, h("td", { colspan: "3", class: "gb-muted" }, "No locations yet. Add one below."))]),
  );
}

function deleteLocation(location, button) {
  if (!confirm(`Delete "${location.name}"?`)) return;
  busy(button, async () => {
    await db(client.from("locations").delete().eq("id", location.id));
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
    name: form.name.value.trim(),
    round_number: Number(form.round_number.value),
    lat: Number(form.lat.value),
    lng: Number(form.lng.value),
    heading: Number(form.heading.value) % 360,
    pitch: Number(form.pitch.value),
  };
}

function preview() {
  const view = readForm();
  if (!Number.isFinite(view.lat) || !Number.isFinite(view.lng) || $("#editor").lat.value === "") return;
  if (!panoPromise) {
    panoPromise = createPanorama($("#admin-pano"));
    panoPromise.catch((error) => $("#admin-pano").replaceChildren(h("p", { class: "gb-pano-message" }, error.message)));
  }
  panoPromise.then((pano) => {
    pano.hide();
    pano.show(view);
  }).catch(() => {});
}

$("#preview").addEventListener("click", preview);

$("#use-view").addEventListener("click", async () => {
  if (!panoPromise) return toast("Preview a place first.");
  const { panorama } = await panoPromise;
  const position = panorama.getPosition();
  const pov = panorama.getPov();
  if (!position) return toast("Preview a place first.");
  const form = $("#editor");
  form.lat.value = Number(position.lat().toFixed(6));
  form.lng.value = Number(position.lng().toFixed(6));
  form.heading.value = Number((((pov.heading % 360) + 360) % 360).toFixed(2));
  form.pitch.value = Number(pov.pitch.toFixed(2));
  toast("View copied into the form. Save to keep it.");
});

$("#editor").addEventListener("submit", (event) => {
  event.preventDefault();
  busy($("#save-location"), async () => {
    const row = readForm();
    if (editingId) await db(client.from("locations").update(row).eq("id", editingId));
    else await db(client.from("locations").insert({ ...row, map_id: selectedMap.id }));
    toast(editingId ? "Location saved." : "Location added.");
    openEditor(null);
    await loadLocations();
  });
});

// ---------- Games ----------

async function loadGames() {
  const games = await db(client.from("games")
    .select("id, code, type, status, map_name, host_id, created_at").order("created_at", { ascending: false }).limit(50));
  const hostIds = [...new Set(games.map((game) => game.host_id))];
  const hosts = hostIds.length ? await db(client.from("profiles").select("id, display_name").in("id", hostIds)) : [];
  const names = new Map(hosts.map((host) => [host.id, host.display_name]));
  $("#games").replaceChildren(
    h("thead", {}, h("tr", {}, h("th", {}, "Game"), h("th", {}, "Host"), h("th", {}, "Status"))),
    h("tbody", {}, games.length ? games.map((game) => h("tr", {},
      h("td", {}, h("a", { href: `/geobarkr/results/?game=${encodeURIComponent(game.id)}`, class: "gb-strong" }, `${GAME_TYPES[game.type]} on ${game.map_name}`),
        h("span", { class: "gb-meta" }, `${formatDate(game.created_at)}, code ${game.code}`)),
      h("td", {}, names.get(game.host_id) || ""),
      h("td", {}, GAME_STATUSES[game.status]),
    )) : [h("tr", {}, h("td", { colspan: "3", class: "gb-muted" }, "No games yet."))]),
  );
}

if (isAdmin) Promise.all([loadMaps(), loadGames()]).catch(showError);
