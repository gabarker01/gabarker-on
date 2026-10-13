// Google Maps and Street View. The map uses GeoBarkr's dark style; pins are
// players' avatars (photo or initials in their colour) drawn as HTML overlays,
// and results draw each guess to the target as a great-circle (geodesic) line.
// Without a key (GOOGLE_MAPS_KEY empty) the same functions come from
// maps-keyless.js: Leaflet maps and Google's keyless Street View embed.
import { GOOGLE_MAPS_KEY } from "./config.js?v=14";
import { avatar } from "./players.js?v=14";
import { haptic, replay } from "./motion.js?v=14";
import { placeLabel } from "./geo.js?v=14";

// Fog: a quiet light map in the app's colours. Roads and labels stay readable;
// businesses and transit are hidden so the map doesn't give places away.
const MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#F7F8FA" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#5E6B7D" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#FFFFFF" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#D3DEEA" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#7D8CA0" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#BFCAD6" }] },
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#2A3647" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#F1F3F5" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFFFFF" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#E1E6EC" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#6B7787" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#FBE3D8" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

const WORLD = {
  center: { lat: 25, lng: 0 },
  zoom: 1,
  minZoom: 1,
  restriction: { latLngBounds: { north: 85, south: -85, east: 180, west: -180 } },
  styles: MAP_STYLE,
  backgroundColor: "#D3DEEA",
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  clickableIcons: false,
  keyboardShortcuts: false,
  // One finger drags the map: on a phone the map is the main thing.
  gestureHandling: "greedy",
};

let mapsPromise = null;

export function loadGoogleMaps() {
  if (!mapsPromise) {
    mapsPromise = new Promise((resolve, reject) => {
      if (!GOOGLE_MAPS_KEY) {
        reject(new Error("Street View and the map need the Google Maps key (geobarkr/js/config.js)"));
        return;
      }
      window.gm_authFailure = () => document.dispatchEvent(new CustomEvent("geobarkr:maps-auth-failed"));
      window.__geobarkrMapsReady = async () => {
        try {
          await Promise.all(["maps", "streetView", "geometry"].map((lib) => google.maps.importLibrary(lib).catch(() => null)));
          resolve(google.maps);
        } catch (error) {
          reject(error);
        }
      };
      const script = document.createElement("script");
      script.src = "https://maps.googleapis.com/maps/api/js"
        + `?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&v=weekly&loading=async&callback=__geobarkrMapsReady`;
      script.async = true;
      script.onerror = () => {
        mapsPromise = null;
        reject(new Error("Couldn't load Google Maps. Check your connection and try again"));
      };
      document.head.appendChild(script);
    });
  }
  return mapsPromise;
}

// An HTML element pinned to a place on the map (bottom-centre at the point).
function htmlMarker(maps, map, position, element, zIndex = 1) {
  class Marker extends maps.OverlayView {
    onAdd() {
      element.style.position = "absolute";
      element.style.zIndex = zIndex;
      this.getPanes().overlayMouseTarget.appendChild(element);
    }
    draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(new maps.LatLng(this.position));
      if (p) {
        element.style.left = `${p.x}px`;
        element.style.top = `${p.y}px`;
      }
    }
    onRemove() { element.remove(); }
    move(next) { this.position = next; this.draw(); }
  }
  const marker = new Marker();
  marker.position = position;
  marker.setMap(map);
  return marker;
}

// A player's pin: avatar in a ring of their colour, with a point at the spot.
export function pinElement(player, colour, { me = false, label = null } = {}) {
  const pin = document.createElement("div");
  pin.className = `gb-pin${me ? " is-me" : ""}`;
  pin.style.setProperty("--c", colour);
  pin.append(avatar(player, colour, 30));
  if (label) {
    const tag = document.createElement("span");
    tag.className = "gb-pin-label";
    tag.textContent = label;
    pin.append(tag);
  }
  return pin;
}

// Your pin drops in where you tapped (and again when you move it), with a tick.
export function dropIn(pin) {
  replay(pin, "is-dropping");
  haptic(5);
}

export function targetElement(place) {
  const el = document.createElement("div");
  el.className = "gb-target";
  el.innerHTML = '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="10" fill="none" stroke="#0E1726" stroke-width="2.4"/><circle cx="17" cy="17" r="4" fill="#0E1726"/><path d="M17 2v6M17 26v6M2 17h6M26 17h6" stroke="#0E1726" stroke-width="2.4" stroke-linecap="round"/></svg>';
  if (place) {
    const label = document.createElement("span");
    label.textContent = place;
    el.append(label);
  }
  return el;
}

// Tap the map to place (or move) your pin.
const keyless = () => import("./maps-keyless.js?v=14");

export async function createGuessMap(element, me, onPick) {
  if (!GOOGLE_MAPS_KEY) return (await keyless()).createGuessMap(element, me, onPick);
  const maps = await loadGoogleMaps();
  const map = new maps.Map(element, WORLD);
  let marker = null;
  let pick = null;
  const pin = pinElement(me.player, me.colour, { me: true });
  map.addListener("click", (event) => {
    pick = { lat: event.latLng.lat(), lng: event.latLng.lng() };
    if (marker) marker.move(pick);
    else marker = htmlMarker(maps, map, pick, pin, 10);
    dropIn(pin);
    onPick?.(pick);
  });
  return {
    map,
    getPick: () => pick,
    reset() {
      pick = null;
      marker?.setMap(null);
      marker = null;
      map.setCenter(WORLD.center);
      map.setZoom(WORLD.zoom);
    },
    getView: () => ({ center: { lat: map.getCenter().lat(), lng: map.getCenter().lng() }, zoom: map.getZoom() }),
    setView(center, zoom) {
      map.setCenter(center);
      map.setZoom(zoom);
    },
    world() {
      map.setCenter(WORLD.center);
      map.setZoom(WORLD.zoom);
    },
  };
}

// Street View at the round's place: no movement arrows, address, road names or
// zoom buttons, but you can still look around, click along the road and pinch.
export async function createPanorama(element) {
  if (!GOOGLE_MAPS_KEY) return (await keyless()).createPanorama(element);
  const maps = await loadGoogleMaps();
  const panorama = new maps.StreetViewPanorama(element, {
    linksControl: false,
    panControl: true,
    enableCloseButton: false,
    addressControl: false,
    zoomControl: false,
    showRoadLabels: false,
    fullscreenControl: false,
    motionTrackingControl: false,
    visible: false,
  });
  let start = null;
  const goTo = (target) => {
    panorama.setPosition({ lat: target.lat, lng: target.lng });
    panorama.setPov({ heading: target.heading || 0, pitch: target.pitch || 0 });
    panorama.setZoom(1);
    panorama.setVisible(true);
  };
  return {
    panorama,
    show(target) {
      const key = `${target.lat},${target.lng},${target.heading},${target.pitch}`;
      if (start?.key === key) return;
      start = { ...target, key };
      goTo(start);
    },
    home() { if (start) goTo(start); },
    hide() { start = null; panorama.setVisible(false); },
    // Calls back with the heading (degrees from north) as you look around.
    onHeading(callback) {
      panorama.addListener("pov_changed", () => callback(panorama.getPov().heading || 0));
      return true;
    },
  };
}

// Results: the target, every guess as an avatar pin, and great-circle lines.
export async function createResultsMap(element) {
  if (!GOOGLE_MAPS_KEY) return (await keyless()).createResultsMap(element);
  const maps = await loadGoogleMaps();
  const map = new maps.Map(element, { ...WORLD, zoom: 2 });
  let drawn = [];
  const clear = () => {
    for (const item of drawn) item.setMap(null);
    drawn = [];
  };
  // targets: [{ lat, lng, place }]; guesses: [{ lat, lng, target, player, colour, me }];
  // inset: room to leave for cards floating over the map, in px.
  function show({ targets = [], guesses = [], inset = {} }) {
    const pad = { top: 60, right: 40, bottom: 40, left: 40, ...inset };
    clear();
    const bounds = new maps.LatLngBounds();
    for (const guess of guesses) {
      if (guess.target) {
        drawn.push(new maps.Polyline({
          path: [guess, guess.target], geodesic: true, map,
          strokeColor: guess.colour, strokeOpacity: 1, strokeWeight: guess.me ? 3 : 2.4, zIndex: guess.me ? 3 : 2,
        }));
      }
    }
    for (const target of targets) {
      drawn.push(htmlMarker(maps, map, target, targetElement(target.place), 5));
      bounds.extend(target);
    }
    for (const guess of guesses) {
      drawn.push(htmlMarker(maps, map, guess, pinElement(guess.player, guess.colour, { me: guess.me }), guess.me ? 12 : 11));
      bounds.extend(guess);
    }
    const points = targets.length + guesses.length;
    if (points === 1) {
      map.setCenter(targets[0] || guesses[0]);
      map.setZoom(5);
      map.panBy(0, (pad.bottom - pad.top) / 2);
    } else if (points > 1) {
      map.fitBounds(bounds, pad);
    }
  }
  return { map, show, clear };
}

// ---------- Making maps ----------

// Where a location is, on the map editor's map: an ink pin.
export function placePinElement() {
  const el = document.createElement("div");
  el.className = "gb-place-pin";
  return el;
}

// A map for setting a location: tap to choose (onPick decides what happens);
// set() moves the pin there.
export async function createPickMap(element, onPick) {
  if (!GOOGLE_MAPS_KEY) return (await keyless()).createPickMap(element, onPick);
  const maps = await loadGoogleMaps();
  const map = new maps.Map(element, { ...WORLD, zoom: 2, styles: MAP_STYLE });
  let marker = null;
  let point = null;
  const pin = placePinElement();
  map.addListener("click", (event) => onPick?.({ lat: event.latLng.lat(), lng: event.latLng.lng() }));
  return {
    map,
    get: () => point,
    clear() {
      point = null;
      marker?.setMap(null);
      marker = null;
    },
    set(next, { zoom = null, pan = true } = {}) {
      point = next;
      if (marker) marker.move(next);
      else marker = htmlMarker(maps, map, next, pin, 10);
      if (zoom != null) map.setZoom(zoom);
      if (pan) map.panTo(next);
    },
  };
}

// Street View you can walk around, for choosing a round's starting view.
// onChange({ lat, lng, heading, pitch }) whenever you move or turn.
export async function createExplorePanorama(element, onChange) {
  if (!GOOGLE_MAPS_KEY) return (await keyless()).createExplorePanorama(element, onChange);
  const maps = await loadGoogleMaps();
  const panorama = new maps.StreetViewPanorama(element, {
    addressControl: false, fullscreenControl: false, motionTrackingControl: false,
    zoomControl: false, enableCloseButton: false, showRoadLabels: true, visible: false,
  });
  const service = new maps.StreetViewService();
  const view = () => {
    const at = panorama.getPosition();
    if (!at) return null;
    const pov = panorama.getPov();
    return { lat: at.lat(), lng: at.lng(), heading: (((pov.heading || 0) % 360) + 360) % 360, pitch: pov.pitch || 0 };
  };
  const changed = () => { const v = view(); if (v) onChange?.(v); };
  panorama.addListener("position_changed", changed);
  panorama.addListener("pov_changed", changed);
  return {
    panorama,
    get: view,
    // The nearest Street View to a point (within 1 km), or an error.
    async goTo(point, { heading = null, pitch = 0, exact = false } = {}) {
      let at = point;
      if (!exact) {
        let found = null;
        for (const radius of [50, 250, 1000]) {
          found = await service.getPanorama({ location: point, radius, preference: "nearest", sources: ["outdoor"] })
            .then((result) => result.data).catch(() => null);
          if (found) break;
        }
        if (!found?.location?.latLng) throw new Error("No Street View near there. Try a road nearby");
        at = { lat: found.location.latLng.lat(), lng: found.location.latLng.lng() };
        // Face where you tapped, unless a heading was given.
        if (heading == null && maps.geometry?.spherical) {
          heading = maps.geometry.spherical.computeHeading(new maps.LatLng(at), new maps.LatLng(point));
        }
      }
      panorama.setPosition(at);
      panorama.setPov({ heading: heading || 0, pitch });
      panorama.setZoom(0);
      panorama.setVisible(true);
      return view() || { ...at, heading: heading || 0, pitch };
    },
  };
}

// Search for a place by name: { lat, lng, label } or an error.
// Needs the Geocoding API switched on for the Maps key.
let geocoderPromise = null;
async function geocoder() {
  if (!GOOGLE_MAPS_KEY) throw new Error("Search needs the Google Maps key");
  if (!geocoderPromise) {
    geocoderPromise = loadGoogleMaps().then(async (maps) => {
      const lib = await maps.importLibrary?.("geocoding").catch(() => null);
      return new (lib?.Geocoder || maps.Geocoder)();
    });
  }
  return geocoderPromise;
}
const geocodeError = (error) => {
  const code = String(error?.code || error?.message || "");
  if (/REQUEST_DENIED/.test(code)) return new Error("Place search needs the Geocoding API switched on for the Maps key");
  if (/ZERO_RESULTS/.test(code)) return new Error("Couldn't find that place");
  return new Error("Couldn't search right now. Try again");
};

export async function searchPlace(query) {
  const coder = await geocoder();
  const { results } = await coder.geocode({ address: query }).catch((error) => { throw geocodeError(error); });
  const best = results?.[0];
  if (!best) throw new Error("Couldn't find that place");
  return { lat: best.geometry.location.lat(), lng: best.geometry.location.lng(), label: placeLabel(best.address_components) || best.formatted_address };
}

// A short name for a point, like "Mayfair, London, UK" ("" if unknown).
export async function placeName(point) {
  try {
    const coder = await geocoder();
    const { results } = await coder.geocode({ location: point });
    const best = results?.find((r) => r.address_components?.some((c) => c.types.includes("locality") || c.types.includes("postal_town"))) || results?.[0];
    return best ? placeLabel(best.address_components) : "";
  } catch {
    return "";
  }
}
