import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6.11.2/dist/maplibre-gl.mjs";

const PLACES = {
  world: { center: [-20, 25], zoom: 1.6, pitch: 0, bearing: 0 },
  london: { center: [-0.1246, 51.5007], zoom: 15.5, pitch: 50, bearing: -20 },
  newyork: { center: [-73.9855, 40.758], zoom: 14.5, pitch: 55, bearing: 30 },
  grandcanyon: { center: [-112.1129, 36.1069], zoom: 12, pitch: 60, bearing: 160 },
  everest: { center: [86.925, 27.9881], zoom: 12, pitch: 65, bearing: -40 },
  sydney: { center: [151.2153, -33.8568], zoom: 15, pitch: 50, bearing: 60 },
};

const IMAGERY_ATTRIBUTION =
  'Imagery &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics';

const esriTiles = (service) =>
  [`https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`];

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const errorBox = document.getElementById("map-error");

const map = new maplibregl.Map({
  container: "map",
  ...PLACES.world,
  maxPitch: 75,
  attributionControl: { compact: true },
  style: {
    version: 8,
    projection: { type: "globe" },
    sky: {
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
    },
    sources: {
      satellite: {
        type: "raster",
        tiles: esriTiles("World_Imagery"),
        tileSize: 256,
        maxzoom: 19,
        attribution: IMAGERY_ATTRIBUTION,
      },
      terrain: {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 15,
        attribution: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen</a>',
      },
      labels: {
        type: "raster",
        tiles: esriTiles("Reference/World_Boundaries_and_Places"),
        tileSize: 256,
        maxzoom: 19,
      },
    },
    terrain: { source: "terrain", exaggeration: 1.4 },
    layers: [
      { id: "satellite", type: "raster", source: "satellite" },
      { id: "labels", type: "raster", source: "labels", layout: { visibility: "none" } },
    ],
  },
});

window.tapmapReady = true;

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
map.addControl(new maplibregl.GlobeControl(), "top-right");
map.addControl(new maplibregl.FullscreenControl(), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

// Show a friendly message if the library or imagery can't be reached at all.
let tilesLoaded = false;
map.on("sourcedata", (e) => {
  if (e.sourceId === "satellite" && e.isSourceLoaded) tilesLoaded = true;
});
map.on("error", (e) => {
  if (!tilesLoaded && e.sourceId === "satellite") errorBox.hidden = false;
});

// Slow auto-rotation while zoomed out, like an idle Google Earth.
const spinButton = document.getElementById("spin-toggle");
let spinning = !reducedMotion;
let interacting = false;

const spin = () => {
  if (!spinning || interacting || map.getZoom() > 4) return;
  const center = map.getCenter();
  center.lng -= 6;
  map.easeTo({ center, duration: 1000, easing: (t) => t });
};

const setSpinning = (on) => {
  spinning = on;
  spinButton.setAttribute("aria-pressed", String(on));
  if (on) spin();
  else map.stop();
};

map.on("mousedown", () => { interacting = true; });
map.on("touchstart", () => { interacting = true; });
map.on("dragstart", () => { interacting = true; });
map.on("mouseup", () => { interacting = false; });
map.on("touchend", () => { interacting = false; });
map.on("dragend", () => { interacting = false; spin(); });
map.on("moveend", spin);
map.on("load", () => {
  spinButton.setAttribute("aria-pressed", String(spinning));
  spin();
});

spinButton.addEventListener("click", () => setSpinning(!spinning));

// Place labels overlay.
const labelsButton = document.getElementById("labels-toggle");
labelsButton.addEventListener("click", () => {
  const show = labelsButton.getAttribute("aria-pressed") !== "true";
  labelsButton.setAttribute("aria-pressed", String(show));
  map.setLayoutProperty("labels", "visibility", show ? "visible" : "none");
});

// Fly-to buttons.
const placeButtons = document.querySelectorAll("[data-place]");
placeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const place = PLACES[button.dataset.place];
    placeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    if (button.dataset.place !== "world") setSpinning(false);
    const options = { ...place, essential: true };
    if (reducedMotion) map.jumpTo(options);
    else map.flyTo({ ...options, speed: 0.9, curve: 1.6 });
  });
});

// Deselect the place buttons once the visitor moves the map themselves.
map.on("dragstart", () => {
  placeButtons.forEach((b) => b.setAttribute("aria-pressed", "false"));
});

// Coordinates and zoom readout.
const readout = document.getElementById("readout");
const formatCoord = (value, pos, neg) => `${Math.abs(value).toFixed(3)}° ${value >= 0 ? pos : neg}`;
const updateReadout = () => {
  const { lng, lat } = map.getCenter();
  readout.textContent =
    `${formatCoord(lat, "N", "S")}, ${formatCoord(lng, "E", "W")} · zoom ${map.getZoom().toFixed(1)}`;
};
map.on("move", updateReadout);
map.on("load", updateReadout);
