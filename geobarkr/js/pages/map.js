// Making a map (from your profile): choose Street View or photos, name it,
// then set its five places. Details save as you type. Each place opens a
// full-screen editor:
// - Street View: search for a place or tap the map, then walk and turn in
//   the live Street View until it's the view players should start with.
// - Photos: choose a photo; if it knows where it was taken, the pin and a
//   place name ("Mayfair, London, UK") fill themselves in. Tap the map to
//   move the pin.
import { initPage, $, h, busy, toast, showError, param, pageReady, closeButton, kindTag, sheetDialog } from "../ui.js?v=14";
import {
  getMyMap, createMyMap, updateMyMap, saveMyLocation, deleteMyLocation, deleteMyMap,
  photoUrl, uploadPhoto, discardPhoto, PHOTO_SIZE,
} from "../api.js?v=14";
import { GOOGLE_MAPS_KEY } from "../config.js?v=14";
import { createPickMap, createExplorePanorama, searchPlace, placeName } from "../maps.js?v=14";
import { preparePhoto, createPhotoView } from "../photo.js?v=14";
import { drawWorld } from "../worldmap.js?v=14";
import { ME_COLOUR } from "../players.js?v=14";
import { formatCoords, haversineKm } from "../geo.js?v=14";

await initPage({ hold: true });

// Character counts under the description boxes.
for (const count of document.querySelectorAll(".gb-count")) {
  const box = document.getElementById(count.dataset.for);
  const update = () => { count.textContent = `${box.value.length}/140`; };
  box.addEventListener("input", update);
  count.update = update;
}
const recount = () => { for (const count of document.querySelectorAll(".gb-count")) count.update(); };

// A two-way switch made of .gb-seg radio buttons.
function radios(group, onChange) {
  const buttons = [...group.querySelectorAll("[role=radio]")];
  const set = (button) => { for (const b of buttons) b.setAttribute("aria-checked", String(b === button)); };
  for (const button of buttons) button.addEventListener("click", () => { set(button); onChange?.(button); });
  return {
    get: () => buttons.find((b) => b.getAttribute("aria-checked") === "true"),
    set: (match) => set(buttons.find(match) || buttons[0]),
  };
}
const VISIBILITY = {
  true: "Anyone can find it in the map list and start a game on it.",
  false: "Only you can start a game on it. Friends can still join your games.",
};

// ---------- New map ----------

function showNew() {
  $("#new").hidden = false;
  document.title = "New map · GeoBarkr";
  const kinds = radios($("#kinds"));
  const visibility = radios($("#new-visibility"), (button) => { $("#new-visibility-note").textContent = VISIBILITY[button.dataset.public]; });
  $("#new-visibility-note").textContent = VISIBILITY.true;
  $("#new-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    busy($("#create-button"), async () => {
      const id = await createMyMap({
        name: form.name.value.trim(), description: form.description.value.trim(),
        kind: kinds.get().dataset.kind, isPublic: visibility.get().dataset.public === "true",
      });
      location.replace(`/geobarkr/map/?id=${encodeURIComponent(id)}&new=1`);
    });
  });
}

// ---------- Editing a map ----------

let map = null;

async function openMap(id) {
  try {
    map = await getMyMap(id);
  } catch (error) {
    $("#edit").hidden = false;
    $("#edit").replaceChildren(h("h1", { class: "gb-title" }, "Can't open this map"),
      h("p", { class: "gb-lede" }, `${error.message}. It may have been deleted, or it isn't yours.`),
      h("a", { class: "gb-btn", href: "/geobarkr/profile/" }, "Back to your profile"));
    return;
  }
  $("#edit").hidden = false;
  $("#kind-tag").replaceChildren(kindTag(map.kind));
  setupDetails();
  renderMap();
  if (param("new")) {
    history.replaceState(null, "", `/geobarkr/map/?id=${encodeURIComponent(map.id)}`);
    // Straight on to the first place.
    setTimeout(() => editor.open(1), 350);
  }
}

const placeAt = (round) => map.locations.find((l) => l.round_number === round) || null;

function renderMap() {
  renderHead();
  $("#slots").replaceChildren(...[1, 2, 3, 4, 5].map((round, i) => slot(round, i)));
}

// The title and the readiness card (all a details save changes).
function renderHead() {
  $("#title").textContent = map.name;
  document.title = `${map.name} · GeoBarkr`;
  const count = map.locations.length;
  const ready = $("#ready");
  ready.className = `gb-ready${count === 5 && map.active ? " is-ready" : ""}`;
  const steps = h("span", { class: "gb-ready-steps", "aria-hidden": "true" },
    Array.from({ length: 5 }, (_, i) => h("i", { class: placeAt(i + 1) ? "done" : "" })));
  if (map.blocked) {
    ready.replaceChildren(steps, h("span", { class: "text" }, h("b", {}, "Blocked"), h("span", {}, "An admin has blocked this map, so nobody can start a game on it.")));
  } else if (count < 5) {
    const left = 5 - count;
    ready.replaceChildren(steps, h("span", { class: "text" }, h("b", {}, `${count} of 5 places`), h("span", {}, `Add ${left} more to play it.`)));
  } else if (!map.active) {
    ready.replaceChildren(steps, h("span", { class: "text" }, h("b", {}, "Switched off"), h("span", {}, "Switch it on below to play it.")));
  } else {
    ready.replaceChildren(steps, h("span", { class: "text" }, h("b", {}, "Ready to play"), h("span", {}, map.is_public ? "Anyone can play it." : "Only you can start a game on it.")),
      h("a", { class: "gb-btn small", href: `/geobarkr/?map=${encodeURIComponent(map.id)}` }, "Play"));
  }
}

function slot(round, i) {
  const place = placeAt(round);
  if (!place) {
    return h("button", { type: "button", class: "gb-slot is-empty", style: `--i:${i}`, onclick: () => editor.open(round) },
      h("span", { class: "n" }, round),
      h("span", { class: "body" }, h("b", {}, `Add place ${round}`), h("span", {}, map.kind === "photo" ? "Choose a photo" : "Find it in Street View")),
      h("span", { class: "plus", "aria-hidden": "true" }, "+"));
  }
  const thumb = h("span", { class: "gb-slot-thumb" });
  if (place.photo_path) thumb.append(h("img", { src: photoUrl(place.photo_path), alt: "", loading: "lazy" }));
  else {
    requestAnimationFrame(() => drawWorld(thumb, {
      view: { lat: place.lat, lng: place.lng, zoom: 2.2 }, grid: false,
      dots: [{ lat: place.lat, lng: place.lng, colour: ME_COLOUR, r: 4, stroke: "#fff", strokeWidth: 1.6 }],
    }));
  }
  return h("button", { type: "button", class: "gb-slot", style: `--i:${i}`, onclick: () => editor.open(round) },
    h("span", { class: "n" }, round), thumb,
    h("span", { class: "body" }, h("b", {}, place.name), h("span", {}, formatCoords(place.lat, place.lng))),
    h("span", { class: "edit" }, "Edit"));
}

// Details save themselves a moment after you stop typing.
function setupDetails() {
  const form = $("#details");
  form.name.value = map.name;
  form.description.value = map.description || "";
  form.active.checked = map.active;
  recount();
  const visibility = radios($("#visibility"), () => save());
  visibility.set((b) => b.dataset.public === String(map.is_public));
  $("#visibility-note").textContent = VISIBILITY[map.is_public];

  let timer = null;
  let saving = Promise.resolve();
  const state = $("#save-state");
  function save(delay = 0) {
    clearTimeout(timer);
    state.textContent = "Editing…";
    timer = setTimeout(() => {
      const next = {
        name: form.name.value.trim(), description: form.description.value.trim(),
        isPublic: visibility.get().dataset.public === "true", active: form.active.checked,
      };
      if (!next.name) { state.textContent = "Needs a name"; return; }
      state.textContent = "Saving…";
      saving = saving.then(() => updateMyMap(map.id, next)).then(() => {
        Object.assign(map, { name: next.name, description: next.description, is_public: next.isPublic, active: next.active });
        $("#visibility-note").textContent = VISIBILITY[map.is_public];
        state.textContent = "Saved";
        renderHead();
      }).catch((error) => {
        state.textContent = "Not saved";
        showError(error);
      });
    }, delay);
  }
  form.name.addEventListener("input", () => save(700));
  form.description.addEventListener("input", () => save(700));
  form.active.addEventListener("change", () => save());
  form.addEventListener("submit", (event) => { event.preventDefault(); save(); });
}

$("#delete-map").addEventListener("click", (event) => {
  if (!confirm(`Delete "${map.name}"? Games already played on it keep their results.`)) return;
  busy(event.currentTarget, async () => {
    await deleteMyMap(map.id);
    location.replace("/geobarkr/profile/");
  });
});

// ---------- The place editor ----------

const editor = (() => {
  const dialog = $("#editor");
  const close = sheetDialog(dialog);
  const isPhoto = () => map.kind === "photo";
  let round = 1;
  let draft = null; // { lat, lng, heading, pitch, photo_path, blob, previewUrl }
  let named = false; // you typed the name yourself: don't replace it
  let original = null; // the place as saved, to tell whether you changed it
  let mapPromise = null;
  let panoPromise = null;
  let photoView = null;
  let lastNamedAt = null;

  const near = (a, b, tolerance) => Math.abs((a ?? 0) - (b ?? 0)) <= tolerance;
  const isDirty = () => Boolean(draft) && (Boolean(draft.blob)
    || $("#place-name").value.trim() !== (original?.name || "")
    || !near(draft.lat, original?.lat, 1e-6) || !near(draft.lng, original?.lng, 1e-6)
    || (!isPhoto() && (!near(draft.heading, original?.heading, 0.5) || !near(draft.pitch, original?.pitch, 0.5))));
  const tryClose = () => {
    if (isDirty() && !confirm("Leave without saving this place?")) return;
    close();
  };
  $("#editor-close").replaceWith(closeButton(tryClose));
  // Escape and taps outside go through the same check.
  dialog.addEventListener("cancel", (event) => { event.stopImmediatePropagation(); event.preventDefault(); tryClose(); }, { capture: true });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) { event.stopImmediatePropagation(); tryClose(); } }, { capture: true });
  dialog.addEventListener("close", () => { if (draft?.previewUrl) URL.revokeObjectURL(draft.previewUrl); });

  const status = (text) => { $("#editor-status").textContent = text; };
  const hint = (text) => { $("#stage-hint").textContent = text; $("#stage-hint").hidden = !text; };
  const canSave = () => Boolean(draft && Number.isFinite(draft.lat) && (!isPhoto() || draft.photo_path || draft.blob));
  const refresh = () => { $("#editor-save").disabled = !canSave(); };

  function pickMap() {
    if (!mapPromise) {
      mapPromise = createPickMap($("#editor-map"), (point) => onMapTap(point));
      mapPromise.catch((error) => $("#editor-map").replaceChildren(h("p", { class: "gb-pano-msg" }, error.message)));
    }
    return mapPromise;
  }
  function pano() {
    if (!panoPromise) {
      panoPromise = createExplorePanorama($("#editor-pano"), (view) => onPanoMove(view));
      panoPromise.catch((error) => $("#editor-pano").replaceChildren(h("p", { class: "gb-pano-msg" }, error.message)));
    }
    return panoPromise;
  }

  // Fill in the place name from the map, unless you've typed one.
  async function nameFrom(point, { force = false } = {}) {
    if (named && !force) return;
    if (lastNamedAt && haversineKm(lastNamedAt.lat, lastNamedAt.lng, point.lat, point.lng) < 0.05 && !force) return;
    lastNamedAt = point;
    const label = await placeName(point);
    if (label && !named && draft && draft.lat === point.lat && draft.lng === point.lng) $("#place-name").value = label;
  }

  function setPoint(point, { zoom = null } = {}) {
    draft = { ...draft, lat: point.lat, lng: point.lng };
    pickMap().then((m) => m.set(point, { zoom })).catch(() => {});
    refresh();
  }

  // Street View: you walked or turned.
  let moveTimer = null;
  function onPanoMove(view) {
    if (!dialog.open || isPhoto()) return;
    const moved = !draft || haversineKm(draft.lat ?? 0, draft.lng ?? 0, view.lat, view.lng) > 0.001;
    draft = { ...draft, ...view };
    if (moved) {
      pickMap().then((m) => m.set(view)).catch(() => {});
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => nameFrom({ lat: view.lat, lng: view.lng }), 600);
    }
    hint("");
    status("Walk and turn until this is the view players should start with.");
    refresh();
  }

  async function goToStreetView(point, options) {
    const p = await pano();
    try {
      const view = await p.goTo(point, options);
      $("#editor-pano").classList.add("is-on");
      onPanoMove(view);
      return view;
    } catch (error) {
      toast(error.message);
      return null;
    }
  }

  async function onMapTap(point) {
    if (isPhoto()) {
      setPoint(point);
      status("Pin moved. Save when it's in the right place.");
      nameFrom(point);
      return;
    }
    const view = await goToStreetView(point);
    if (view) pickMap().then((m) => m.set(view)).catch(() => {});
  }

  $("#search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = $("#search").value.trim();
    if (!query) return;
    $("#search").blur();
    try {
      const found = await searchPlace(query);
      if (isPhoto()) {
        // The pin goes there; tap the map to fine-tune it.
        setPoint(found, { zoom: 15 });
        if (!named && found.label) {
          $("#place-name").value = found.label;
          lastNamedAt = { lat: found.lat, lng: found.lng };
        }
        status("Pin placed. Tap the map to move it exactly.");
        return;
      }
      const view = await goToStreetView(found);
      if (view) {
        (await pickMap()).set(view, { zoom: 16 });
        if (!named && found.label) {
          $("#place-name").value = found.label;
          lastNamedAt = { lat: view.lat, lng: view.lng }; // keep the searched name until you walk away
        }
      }
    } catch (error) {
      toast(error.message);
    }
  });
  $("#place-name").addEventListener("input", () => {
    named = $("#place-name").value.trim().length > 0;
  });

  // ---------- Photos ----------
  function showPhoto(url) {
    photoView ||= createPhotoView($("#editor-photo"));
    photoView.show({ photo_url: url });
    $("#photo-pick").hidden = true;
    $("#change-photo").hidden = false;
  }
  $("#change-photo").addEventListener("click", () => $("#photo-input").click());
  $("#photo-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    status("Reading the photo…");
    try {
      const photo = await preparePhoto(file, PHOTO_SIZE);
      if (draft?.previewUrl) URL.revokeObjectURL(draft.previewUrl);
      const previewUrl = URL.createObjectURL(photo.blob);
      draft = { ...draft, blob: photo.blob, previewUrl, photo_path: null };
      showPhoto(previewUrl);
      if (photo.gps) {
        named = false;
        setPoint(photo.gps, { zoom: 14 });
        status("Placed from where the photo was taken. Tap the map to move it.");
        nameFrom(photo.gps, { force: true });
      } else {
        status(Number.isFinite(draft.lat) ? "This photo doesn't say where it was taken. The pin stays where it was." : "This photo doesn't say where it was taken. Search, or tap the map to place it.");
      }
      refresh();
    } catch (error) {
      status("");
      showError(error);
    }
  });

  // ---------- Open, save, remove ----------
  async function open(n) {
    round = n;
    const place = placeAt(n);
    draft = place ? { ...place } : {};
    original = place ? { ...place } : null;
    named = Boolean(place);
    lastNamedAt = place ? { lat: place.lat, lng: place.lng } : null;
    $("#editor-title").textContent = `Place ${n} of 5`;
    $("#place-name").value = place?.name || "";
    $("#editor-clear").hidden = !place;
    $("#search").value = "";
    dialog.classList.toggle("is-photo", isPhoto());
    // Search sits over Street View, or above the map for photos.
    $("#search-form").hidden = !GOOGLE_MAPS_KEY;
    if (isPhoto()) $(".gb-editor-map").before($("#search-form"));
    else $("#stage").append($("#search-form"));
    $("#photo-pick").hidden = !isPhoto() || Boolean(place);
    $("#change-photo").hidden = !isPhoto() || !place;
    $("#editor-pano").classList.toggle("is-on", Boolean(place) && !isPhoto());
    if (photoView && !place) photoView.hide();
    refresh();
    dialog.showModal();
    dialog.focus(); // not the close button, which would show a focus ring

    const m = await pickMap().catch(() => null);
    if (place) m?.set(place, { zoom: isPhoto() ? 13 : 15 });
    else if (m) {
      m.clear();
      resetMap(m);
    }

    if (isPhoto()) {
      hint("");
      if (place) {
        showPhoto(photoUrl(place.photo_path));
        status("Tap the map to move the pin, or change the photo.");
      } else {
        status("Choose a photo. If it knows where it was taken, the pin goes there.");
      }
    } else if (place) {
      hint("");
      status("Walk and turn until this is the view players should start with.");
      await goToStreetView(place, { heading: place.heading, pitch: place.pitch, exact: true });
    } else {
      hint(GOOGLE_MAPS_KEY ? "Search for a place, or tap the map below." : "Tap the map below to choose a place.");
      status("");
    }
  }
  function resetMap(m) {
    // An empty place: show the world, or where the last place was.
    const last = [...map.locations].sort((a, b) => b.round_number - a.round_number)[0];
    if (m.map?.setZoom) {
      m.map.setZoom(last ? 4 : 1);
      m.map.setCenter?.(last ? { lat: last.lat, lng: last.lng } : { lat: 25, lng: 0 });
    } else if (m.map?.setView) {
      m.map.setView(last ? [last.lat, last.lng] : [25, 0], last ? 4 : 1, { animate: false });
    }
  }

  $("#editor-save").addEventListener("click", (event) => busy(event.currentTarget, async () => {
    if (!canSave()) return;
    let name = $("#place-name").value.trim();
    if (!name) name = (await placeName(draft)) || `Place ${round}`;
    let uploaded = null;
    if (isPhoto() && draft.blob) {
      status("Uploading the photo…");
      uploaded = await uploadPhoto(draft.blob);
    }
    try {
      const row = {
        name, lat: draft.lat, lng: draft.lng,
        heading: isPhoto() ? 0 : draft.heading || 0, pitch: isPhoto() ? 0 : draft.pitch || 0,
        photo_path: isPhoto() ? uploaded || draft.photo_path : null,
      };
      await saveMyLocation(map.id, round, row);
      map.locations = [...map.locations.filter((l) => l.round_number !== round), { round_number: round, ...row }]
        .sort((a, b) => a.round_number - b.round_number);
    } catch (error) {
      if (uploaded) discardPhoto(uploaded);
      status("");
      throw error;
    }
    original = { ...draft, name };
    close();
    renderMap();
    const next = [1, 2, 3, 4, 5].find((r) => !placeAt(r));
    toast(next ? `Place ${round} saved.` : "All five places are in. Your map is ready.");
  }));

  $("#editor-clear").addEventListener("click", (event) => {
    if (!confirm(`Remove place ${round}?`)) return;
    busy(event.currentTarget, async () => {
      await deleteMyLocation(map.id, round);
      map.locations = map.locations.filter((l) => l.round_number !== round);
      draft = null;
      close();
      renderMap();
      toast(`Place ${round} removed.`);
    });
  });

  return { open };
})();

// ---------- Start ----------

const mapId = param("id");
if (mapId) await openMap(mapId);
else showNew();
pageReady();
