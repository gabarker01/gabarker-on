// Maps without a Google Maps key, so the game can be tried before one exists:
// the guess and results maps use Leaflet with CARTO's dark OpenStreetMap
// tiles, and Street View is Google's keyless embed in an iframe. maps.js
// switches to this file while GOOGLE_MAPS_KEY in config.js is empty.
import { loadScript } from "./load.js";
import { greatCircle } from "./geo.js";
import { pinElement, targetElement, dropIn } from "./maps.js";

const WORLD = { center: [25, 0], zoom: 1 };
let leafletPromise = null;

function loadLeaflet() {
  if (!leafletPromise) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/geobarkr/vendor/leaflet-1.9.4.css";
    document.head.append(css);
    leafletPromise = loadScript("/geobarkr/vendor/leaflet-1.9.4.js").then(() => window.L);
  }
  return leafletPromise;
}

async function newMap(element, zoom = WORLD.zoom) {
  const L = await loadLeaflet();
  element.classList.add("gb-leaflet");
  const map = L.map(element, {
    center: WORLD.center, zoom, minZoom: 1, worldCopyJump: true,
    zoomControl: false, attributionControl: true, zoomSnap: 0.5,
  });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd", maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);
  map.attributionControl.setPrefix(false);
  // The map's box changes size (the guess sheet expands), so keep tiles filling it.
  new ResizeObserver(() => map.invalidateSize()).observe(element);
  return { L, map };
}

// An HTML element at a point; .gb-pin / .gb-target position themselves on it.
function htmlMarker(L, map, position, element, zIndex) {
  element.style.position = "absolute";
  const box = document.createElement("div");
  box.append(element);
  return L.marker(position, {
    icon: L.divIcon({ html: box, className: "gb-leaflet-icon", iconSize: [0, 0], iconAnchor: [0, 0] }),
    interactive: false, keyboard: false, zIndexOffset: zIndex * 100,
  }).addTo(map);
}

export async function createGuessMap(element, me, onPick) {
  const { L, map } = await newMap(element);
  let marker = null;
  let pick = null;
  const pin = pinElement(me.player, me.colour, { me: true });
  map.on("click", (event) => {
    const at = event.latlng.wrap();
    pick = { lat: at.lat, lng: at.lng };
    if (marker) marker.setLatLng(event.latlng);
    else marker = htmlMarker(L, map, event.latlng, pin, 10);
    dropIn(pin);
    onPick?.(pick);
  });
  return {
    map,
    getPick: () => pick,
    reset() {
      pick = null;
      marker?.remove();
      marker = null;
      map.setView(WORLD.center, WORLD.zoom);
    },
  };
}

export async function createResultsMap(element) {
  const { L, map } = await newMap(element, 2);
  let drawn = [];
  const clear = () => {
    for (const item of drawn) item.remove();
    drawn = [];
  };
  function show({ targets = [], guesses = [] }) {
    clear();
    const points = [];
    for (const guess of guesses) {
      if (!guess.target) continue;
      const line = greatCircle(guess, guess.target, 64).map((p) => [p.lat, p.lng]);
      drawn.push(L.polyline(line, { color: guess.colour, weight: guess.me ? 3 : 2.4, opacity: 1, interactive: false }).addTo(map));
      points.push(...line);
    }
    for (const target of targets) {
      drawn.push(htmlMarker(L, map, [target.lat, target.lng], targetElement(target.place), 5));
      points.push([target.lat, target.lng]);
    }
    for (const guess of guesses) {
      drawn.push(htmlMarker(L, map, [guess.lat, guess.lng], pinElement(guess.player, guess.colour, { me: guess.me }), guess.me ? 12 : 11));
      points.push([guess.lat, guess.lng]);
    }
    if (targets.length + guesses.length === 1) map.setView(points[0], 5);
    else if (points.length) map.fitBounds(L.latLngBounds(points), { paddingTopLeft: [40, 60], paddingBottomRight: [40, 40], maxZoom: 12 });
  }
  return { map, show, clear };
}

// Street View through Google's keyless embed. The iframe is taller than its
// box and shifted up, so the address card in its top corner stays hidden.
export async function createPanorama(element) {
  let start = null;
  let frame = null;
  const goTo = (target) => {
    const url = "https://www.google.com/maps?layer=c&output=svembed&hl=en"
      + `&cbll=${target.lat},${target.lng}&cbp=12,${target.heading || 0},0,0,${-(target.pitch || 0)}`;
    frame?.remove();
    frame = document.createElement("iframe");
    frame.className = "gb-sv-embed";
    frame.title = "Street View";
    frame.referrerPolicy = "no-referrer";
    frame.allow = "fullscreen; accelerometer; gyroscope";
    frame.src = url;
    element.append(frame);
  };
  return {
    panorama: null,
    show(target) {
      const key = `${target.lat},${target.lng},${target.heading},${target.pitch}`;
      if (start?.key === key) return;
      start = { ...target, key };
      goTo(start);
    },
    home() { if (start) goTo(start); },
    hide() { start = null; frame?.remove(); frame = null; },
  };
}
