// Tappable 3D globe for TapMap, built on MapLibre GL's globe projection.
//
// The globe is drawn from a self-hosted Natural Earth outline (no tiles, no
// labels to give answers away). Arcs are true great circles; their longitudes
// are unwrapped so a guess in Alaska for Fiji arcs across the Pacific.

import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6.11.2/dist/maplibre-gl.mjs";

const WORLD_COARSE = "world-110m.geojson?v=1";
const WORLD_DETAILED = "world-50m.geojson?v=1";
const EMPTY = { type: "FeatureCollection", features: [] };

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

// Points along the great circle from a to b, with continuous (unwrapped) longitudes.
export function greatCircle(a, b, steps = 96) {
  const toVec = ({ lat, lng }) => [
    Math.cos(rad(lat)) * Math.cos(rad(lng)),
    Math.cos(rad(lat)) * Math.sin(rad(lng)),
    Math.sin(rad(lat)),
  ];
  const va = toVec(a);
  const vb = toVec(b);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  const coords = [];
  let prevLng = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let v;
    if (omega < 1e-9) {
      v = va;
    } else {
      const s = Math.sin(omega);
      const k1 = Math.sin((1 - t) * omega) / s;
      const k2 = Math.sin(t * omega) / s;
      v = [k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]];
    }
    let lng = deg(Math.atan2(v[1], v[0]));
    const lat = deg(Math.atan2(v[2], Math.hypot(v[0], v[1])));
    if (prevLng !== null) lng += 360 * Math.round((prevLng - lng) / 360);
    prevLng = lng;
    coords.push([lng, lat]);
  }
  return coords;
}

function graticule(step = 30) {
  const lines = [];
  for (let lng = -180; lng < 180; lng += step) {
    lines.push(Array.from({ length: 33 }, (_, i) => [lng, -80 + i * 5]));
  }
  for (let lat = -60; lat <= 60; lat += step) {
    lines.push(Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]));
  }
  return { type: "Feature", geometry: { type: "MultiLineString", coordinates: lines } };
}

function skyFor(colors) {
  return {
    "sky-color": colors.space,
    "horizon-color": colors.atmosphere,
    "fog-color": colors.atmosphere,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 4, 0.7, 7, 0],
  };
}

function buildStyle(colors) {
  return {
    version: 8,
    projection: { type: "globe" },
    sky: skyFor(colors),
    sources: {
      world: { type: "geojson", data: WORLD_COARSE, tolerance: 0.2 },
      graticule: { type: "geojson", data: graticule() },
      arcs: { type: "geojson", data: EMPTY },
      dots: { type: "geojson", data: EMPTY },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": colors.ocean } },
      {
        id: "graticule", type: "line", source: "graticule",
        paint: { "line-color": colors.graticule, "line-width": 0.6 },
      },
      {
        id: "land", type: "fill", source: "world",
        filter: ["==", ["get", "kind"], "land"],
        // Antialiasing outlines tile edges on the globe, leaving faint seams.
        paint: { "fill-color": colors.land, "fill-antialias": false },
      },
      {
        id: "borders", type: "line", source: "world",
        filter: ["==", ["get", "kind"], "border"],
        paint: {
          "line-color": colors.border,
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.3, 4, 0.8, 8, 1.4],
        },
      },
      {
        id: "arc-glow", type: "line", source: "arcs",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": colors.arc, "line-width": 8, "line-opacity": 0.18, "line-blur": 4 },
      },
      {
        id: "arcs", type: "line", source: "arcs",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": colors.arc, "line-width": 2.25 },
      },
      {
        id: "dots", type: "circle", source: "dots",
        paint: {
          "circle-radius": ["match", ["get", "kind"], "answer", 4.5, 3.5],
          "circle-color": ["match", ["get", "kind"], "answer", colors.answer, colors.guess],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": colors.ocean,
        },
      },
    ],
  };
}

function applyColors(map, colors) {
  map.setPaintProperty("ocean", "background-color", colors.ocean);
  map.setPaintProperty("graticule", "line-color", colors.graticule);
  map.setPaintProperty("land", "fill-color", colors.land);
  map.setPaintProperty("borders", "line-color", colors.border);
  map.setPaintProperty("arc-glow", "line-color", colors.arc);
  map.setPaintProperty("arcs", "line-color", colors.arc);
  map.setPaintProperty("dots", "circle-color", ["match", ["get", "kind"], "answer", colors.answer, colors.guess]);
  map.setPaintProperty("dots", "circle-stroke-color", colors.ocean);
  map.setSky(skyFor(colors));
}

// Zoom at which the whole globe fills `fraction` of the smaller side.
function globeZoom(container, fraction = 0.86) {
  const size = Math.min(container.clientWidth, container.clientHeight) || 360;
  return Math.log2((fraction * size * Math.PI) / 512);
}

function whenLoaded(map) {
  return new Promise((resolve, reject) => {
    if (map.loaded()) resolve();
    map.once("load", resolve);
    map.once("error", (e) => { if (!map.loaded()) reject(e.error || e); });
  });
}

function afterMove(map, fallbackMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, fallbackMs);
    map.once("moveend", () => { clearTimeout(timer); resolve(); });
  });
}

function pinElement(kind, animate) {
  const el = document.createElement("div");
  el.className = `pin pin-${kind}`;
  el.innerHTML =
    `<div class="pin-body${animate ? " pin-drop" : ""}">` +
    '<svg viewBox="-12 -30 24 32" width="26" height="34" aria-hidden="true">' +
    '<ellipse class="pin-shadow" cx="0" cy="0" rx="4.5" ry="1.6"/>' +
    '<path class="pin-shape" d="M0 0C-1.6-6-9-10-9-17a9 9 0 0 1 18 0c0 7-7.4 11-9 17z"/>' +
    '<circle class="pin-eye" cx="0" cy="-17" r="3.2"/></svg></div>';
  return el;
}

export async function createGlobe(container, { onTap, reducedMotion = false, colors }) {
  const homeZoom = () => globeZoom(container);
  const map = new maplibregl.Map({
    container,
    style: buildStyle(colors),
    center: [15, 22],
    zoom: homeZoom(),
    minZoom: homeZoom() - 0.6,
    maxZoom: 11,
    maxPitch: 0,
    clickTolerance: 6,
    doubleClickZoom: false,
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: false,
    fadeDuration: 0,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();

  await whenLoaded(map);

  // Swap in the detailed outline once the first frame is up.
  map.once("idle", () => map.getSource("world").setData(WORLD_DETAILED));

  map.on("click", (event) => {
    if (!onTap) return;
    // Ignore taps in space: a point on the globe projects back onto itself.
    const back = map.project(event.lngLat);
    if (Math.hypot(back.x - event.point.x, back.y - event.point.y) > 4) return;
    onTap({ lng: wrapLng(event.lngLat.lng), lat: event.lngLat.lat });
  });

  new ResizeObserver(() => {
    map.resize();
    map.setMinZoom(homeZoom() - 0.6);
  }).observe(container);

  let markers = [];
  let guessMarker = null;
  let arcFeatures = [];

  const setArcs = () => map.getSource("arcs").setData({ type: "FeatureCollection", features: arcFeatures });

  function addMarker(lnglat, kind) {
    const marker = new maplibregl.Marker({ element: pinElement(kind, !reducedMotion), anchor: "bottom" })
      .setLngLat([lnglat.lng, lnglat.lat])
      .addTo(map);
    markers.push(marker);
    return marker;
  }

  function setGuess(lnglat) {
    if (!guessMarker) {
      guessMarker = addMarker(lnglat, "guess");
      return;
    }
    guessMarker.setLngLat([lnglat.lng, lnglat.lat]);
    if (!reducedMotion) {
      const body = guessMarker.getElement().querySelector(".pin-body");
      body.classList.remove("pin-drop");
      void body.offsetWidth;
      body.classList.add("pin-drop");
    }
  }

  function animateArc(coords, duration) {
    const feature = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords.slice(0, 2) } };
    arcFeatures.push(feature);
    if (reducedMotion) {
      feature.geometry.coordinates = coords;
      setArcs();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - t) ** 3;
        const count = Math.max(2, Math.round(eased * (coords.length - 1)) + 1);
        feature.geometry.coordinates = coords.slice(0, count);
        setArcs();
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async function reveal(guess, answer, padding) {
    const coords = greatCircle(guess, answer);
    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0]),
    );
    map.fitBounds(bounds, {
      padding,
      maxZoom: 5.5,
      duration: reducedMotion ? 0 : 1100,
      essential: true,
    });
    await afterMove(map, reducedMotion ? 50 : 1600);
    await animateArc(coords, 900);
    addMarker(answer, "answer");
  }

  function clear() {
    markers.forEach((m) => m.remove());
    markers = [];
    guessMarker = null;
    arcFeatures = [];
    setArcs();
  }

  function reset() {
    clear();
    map.easeTo({ zoom: homeZoom(), duration: reducedMotion ? 0 : 900, essential: true });
  }

  return {
    setGuess,
    reveal,
    reset,
    clear,
    zoomIn: () => map.zoomIn({ duration: reducedMotion ? 0 : 250 }),
    zoomOut: () => map.zoomOut({ duration: reducedMotion ? 0 : 250 }),
    setColors: (next) => applyColors(map, next),
  };
}

// Small, slowly turning globe with every round's arc, for the results screen.
export async function createSummaryGlobe(container, rounds, { colors, reducedMotion = false }) {
  const answers = rounds.map((r) => r.answer);
  // Centre on the average answer direction.
  const v = answers.reduce((acc, { lat, lng }) => [
    acc[0] + Math.cos(rad(lat)) * Math.cos(rad(lng)),
    acc[1] + Math.cos(rad(lat)) * Math.sin(rad(lng)),
    acc[2] + Math.sin(rad(lat)),
  ], [0, 0, 0]);
  const centre = [deg(Math.atan2(v[1], v[0])), Math.max(-50, Math.min(50, deg(Math.atan2(v[2], Math.hypot(v[0], v[1])))))];

  const map = new maplibregl.Map({
    container,
    style: buildStyle(colors),
    center: centre,
    zoom: globeZoom(container, 0.92),
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
  });
  await whenLoaded(map);

  map.getSource("arcs").setData({
    type: "FeatureCollection",
    features: rounds.map((r) => ({
      type: "Feature", properties: {},
      geometry: { type: "LineString", coordinates: greatCircle(r.guess, r.answer) },
    })),
  });
  map.getSource("dots").setData({
    type: "FeatureCollection",
    features: rounds.flatMap((r) => [
      { type: "Feature", properties: { kind: "guess" }, geometry: { type: "Point", coordinates: [r.guess.lng, r.guess.lat] } },
      { type: "Feature", properties: { kind: "answer" }, geometry: { type: "Point", coordinates: [r.answer.lng, r.answer.lat] } },
    ]),
  });

  let frameId = null;
  if (!reducedMotion) {
    let last = performance.now();
    const spin = (now) => {
      const c = map.getCenter();
      map.setCenter([c.lng + ((now - last) / 1000) * 4, c.lat]);
      last = now;
      frameId = requestAnimationFrame(spin);
    };
    frameId = requestAnimationFrame(spin);
  }

  return {
    setColors: (next) => applyColors(map, next),
    destroy() {
      if (frameId) cancelAnimationFrame(frameId);
      map.remove();
    },
  };
}
