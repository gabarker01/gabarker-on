// Google Maps and Street View. The map uses GeoBarkr's dark style; pins are
// players' avatars (photo or initials in their colour) drawn as HTML overlays,
// and results draw each guess to the target as a great-circle (geodesic) line.
// Without a key (GOOGLE_MAPS_KEY empty) the same functions come from
// maps-keyless.js: Leaflet maps and Google's keyless Street View embed.
import { GOOGLE_MAPS_KEY } from "./config.js";
import { avatar } from "./players.js";
import { haptic, replay } from "./motion.js";

// Midnight: the map in the app's colours. Roads and labels stay readable;
// businesses and transit are hidden so the map doesn't give places away.
const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1B2A47" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8FA3C7" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0B1426" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0A1324" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4F6182" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#33476E" }] },
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#A9B9D6" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#1D2D4C" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2A3D63" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#7F93B8" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#34507F" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

const WORLD = {
  center: { lat: 25, lng: 0 },
  zoom: 1,
  minZoom: 1,
  restriction: { latLngBounds: { north: 85, south: -85, east: 180, west: -180 } },
  styles: DARK_STYLE,
  backgroundColor: "#0A1324",
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
  el.innerHTML = '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="10" fill="none" stroke="#fff" stroke-width="2.4"/><circle cx="17" cy="17" r="4" fill="#fff"/><path d="M17 2v6M17 26v6M2 17h6M26 17h6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>';
  if (place) {
    const label = document.createElement("span");
    label.textContent = place;
    el.append(label);
  }
  return el;
}

// Tap the map to place (or move) your pin.
const keyless = () => import("./maps-keyless.js");

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
  // targets: [{ lat, lng, place }]; guesses: [{ lat, lng, target, player, colour, me }]
  function show({ targets = [], guesses = [] }) {
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
    } else if (points > 1) {
      map.fitBounds(bounds, { top: 60, right: 40, bottom: 40, left: 40 });
    }
  }
  return { map, show, clear };
}
