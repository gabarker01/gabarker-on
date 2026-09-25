// Tappable 3D globe for TapMap, built on MapLibre GL's globe projection.
//
// Satellite imagery with no labels or borders (nothing to give answers away),
// over a plain self-hosted land outline that shows if the imagery can't load.
// Arcs are true great circles; their longitudes are unwrapped so a guess in
// Alaska for Fiji arcs across the Pacific.

import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6.11.2/dist/maplibre-gl.mjs";
import { createSpace } from "./space.js";

const LAND = "land-110m.geojson?v=1";
const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const IMAGERY_CREDIT = "Imagery © Esri, Maxar, Earthstar Geographics";
const EMPTY = { type: "FeatureCollection", features: [] };

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const toVec = ({ lat, lng }) => [
  Math.cos(rad(lat)) * Math.cos(rad(lng)),
  Math.cos(rad(lat)) * Math.sin(rad(lng)),
  Math.sin(rad(lat)),
];
const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

// Points along the great circle from a to b, with continuous (unwrapped) longitudes.
export function greatCircle(a, b, steps = 96) {
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

// A soft atmospheric glow around the globe that fades as you zoom in.
function skyFor(colors) {
  return {
    "sky-color": colors.space,
    "horizon-color": colors.atmosphere,
    "fog-color": colors.atmosphere,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.3, 4, 0.2, 7, 0],
  };
}

function buildStyle(colors) {
  return {
    version: 8,
    projection: { type: "globe" },
    sky: skyFor(colors),
    sources: {
      land: { type: "geojson", data: LAND, tolerance: 0.2 },
      satellite: { type: "raster", tiles: [IMAGERY], tileSize: 256, maxzoom: 19 },
      arcs: { type: "geojson", data: EMPTY },
      "friend-arcs": { type: "geojson", data: EMPTY },
      dots: { type: "geojson", data: EMPTY },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": colors.ocean } },
      {
        id: "land", type: "fill", source: "land",
        // Antialiasing outlines tile edges on the globe, leaving faint seams.
        paint: { "fill-color": colors.land, "fill-antialias": false },
      },
      {
        id: "satellite", type: "raster", source: "satellite",
        paint: { "raster-fade-duration": 200 },
      },
      {
        // Friends' guesses: dark green with a white outline, under your gold line.
        id: "friend-arc-outline", type: "line", source: "friend-arcs",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 3.6, "line-opacity": 0.95 },
      },
      {
        id: "friend-arcs", type: "line", source: "friend-arcs",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#1f6b45", "line-width": 2 },
      },
      {
        id: "arc-glow", type: "line", source: "arcs",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": colors.arc, "line-width": 8, "line-opacity": 0.18, "line-blur": 4 },
      },
      {
        // Thin white edge either side of the arc so it reads over any imagery.
        id: "arc-outline", type: "line", source: "arcs",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 3.75, "line-opacity": 0.95 },
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
  map.setPaintProperty("land", "fill-color", colors.land);
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

// An even halo behind the globe. With no pitch the globe's centre is always the
// container's centre, and its on-screen radius follows from the zoom level.
function attachHalo(map, container) {
  const halo = document.createElement("div");
  halo.className = "globe-halo";
  container.prepend(halo);
  const update = () => {
    // Measure the globe's silhouette: the furthest projected point along the
    // centre meridian (perspective makes it smaller than the zoom alone implies).
    const c = map.getCenter();
    const centre = map.project(c);
    let radius = 0;
    for (let d = 40; d <= 90; d += 2) {
      const p = map.project([c.lng, Math.max(-89.9, c.lat - d)]);
      radius = Math.max(radius, Math.hypot(p.x - centre.x, p.y - centre.y));
    }
    halo.style.width = halo.style.height = `${radius * 1.98}px`;
    halo.style.opacity = String(Math.max(0, Math.min(1, 1 - (map.getZoom() - 2.5) / 2)));
  };
  map.on("zoom", update);
  map.once("load", update);
  update();
}

// Resolves once the style is ready to use. Tiles (e.g. satellite imagery) keep
// loading in the background: a slow or failing tile server must never stop the
// game from starting, so only style errors (no sourceId) are fatal, and the
// wait for the first full render is capped.
function whenLoaded(map, capMs = 4000) {
  return new Promise((resolve, reject) => {
    let styleReady = false;
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const onStyle = () => {
      styleReady = true;
      timer = setTimeout(done, capMs);
    };
    if (map.loaded()) return done();
    if (map.isStyleLoaded()) onStyle();
    else map.once("style.load", onStyle);
    map.once("load", done);
    map.on("error", (e) => {
      if (e && e.sourceId) return; // a tile or data source failed: carry on
      if (!styleReady) reject(e.error || e);
    });
  });
}

function afterMove(map, fallbackMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, fallbackMs);
    map.once("moveend", () => { clearTimeout(timer); resolve(); });
  });
}

// A friend's pin: their photo or initials in a disc on a short stem.
function friendPinElement(friend, animate) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "pin pin-friend";
  el.setAttribute("aria-label", `${friend.name}'s guess`);
  const body = document.createElement("span");
  body.className = animate ? "pin-body pin-drop" : "pin-body";
  body.style.setProperty("--avatar", friend.colour);
  const badge = document.createElement("span");
  badge.className = "friend-pin-badge";
  badge.textContent = friend.initials;
  if (friend.avatarUrl) {
    const img = document.createElement("img");
    img.src = friend.avatarUrl;
    img.alt = "";
    img.addEventListener("load", () => badge.classList.add("has-photo"));
    img.addEventListener("error", () => img.remove());
    badge.append(img);
  }
  const stem = document.createElement("span");
  stem.className = "friend-pin-stem";
  body.append(badge, stem);
  el.append(body);
  return el;
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
    maxZoom: 14,
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
  attachHalo(map, container);
  const space = createSpace(container, map, { reducedMotion });

  await whenLoaded(map);

  map.on("click", (event) => {
    if (!onTap) return;
    // Ignore taps in space: a point on the globe projects back onto itself.
    const back = map.project(event.lngLat);
    if (Math.hypot(back.x - event.point.x, back.y - event.point.y) > 4) {
      space.tap(event.point.x, event.point.y);
      return;
    }
    onTap({ lng: wrapLng(event.lngLat.lng), lat: event.lngLat.lat });
  });

  new ResizeObserver(() => {
    map.resize();
    map.setMinZoom(homeZoom() - 0.6);
  }).observe(container);

  let markers = [];
  let popups = [];
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

  // Friends: [{ guess: {lat,lng}, initials, colour, name }] who played this round.
  async function reveal(guess, answer, padding, friends = []) {
    const coords = greatCircle(guess, answer);
    const friendLines = friends.map((f) => greatCircle(f.guess, answer));
    const bounds = [coords, ...friendLines].flat().reduce(
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
    // Friends' pins go on top so they stay visible even right next to the answer.
    if (friends.length) {
      map.getSource("friend-arcs").setData({
        type: "FeatureCollection",
        features: friends.map((f, i) => ({
          type: "Feature", properties: { colour: f.colour },
          geometry: { type: "LineString", coordinates: friendLines[i] },
        })),
      });
      friends.forEach((f) => {
        const element = friendPinElement(f, !reducedMotion);
        const marker = new maplibregl.Marker({ element, anchor: "bottom" })
          .setLngLat([f.guess.lng, f.guess.lat])
          .addTo(map);
        // Tap a friend's pin for their name and how their guess went.
        if (f.details) {
          const popup = new maplibregl.Popup({ offset: [0, -34], closeButton: false, maxWidth: "260px", className: "friend-popup" })
            .setDOMContent(f.details());
          marker.setPopup(popup);
          popups.push(popup);
        }
        markers.push(marker);
      });
    }
  }

  function clear() {
    popups.forEach((p) => p.remove());
    popups = [];
    markers.forEach((m) => m.remove());
    markers = [];
    guessMarker = null;
    arcFeatures = [];
    setArcs();
    map.getSource("friend-arcs").setData(EMPTY);
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
// Results globe: every round's arc, turning slowly. Drag in any direction to
// turn it (zoom is off). A score bubble sits
// over whichever answer faces you; tap it for that round's details.
export async function createSummaryGlobe(container, rounds, { colors, details = [], reducedMotion = false }) {
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
  attachHalo(map, container);
  const space = createSpace(container, map, { reducedMotion, eggs: false });
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

  const span = (cls, text) => {
    const el = document.createElement("span");
    el.className = cls;
    el.textContent = text;
    return el;
  };

  // MapLibre controls the marker element's own opacity, so fade an inner bubble.
  let expanded = -1;
  const bubbles = rounds.map((r, i) => {
    const holder = document.createElement("div");
    const el = document.createElement("button");
    el.type = "button";
    el.className = "score-bubble";
    el.setAttribute("aria-expanded", "false");
    const score = document.createElement("span");
    score.className = "bubble-score";
    score.append(span("bubble-value", String(r.score)), span("bubble-of", "/100"));
    el.append(score);
    const d = details[i];
    if (d) {
      const more = document.createElement("span");
      more.className = "bubble-more";
      more.append(span("bubble-round", d.round), span("bubble-name", d.name), span("bubble-meta", d.meta));
      el.append(more);
    }
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      setExpanded(expanded === i ? -1 : i);
    });
    holder.append(el);
    const marker = new maplibregl.Marker({ element: holder, anchor: "bottom", offset: [0, -8] })
      .setLngLat([r.answer.lng, r.answer.lat])
      .addTo(map);
    return { el, marker, v: toVec(r.answer) };
  });

  function setExpanded(i) {
    expanded = i;
    bubbles.forEach((b, j) => {
      b.el.classList.toggle("is-expanded", j === i);
      b.el.setAttribute("aria-expanded", String(j === i));
    });
  }

  let shown = -1;
  const updateBubbles = () => {
    const c = map.getCenter();
    const view = toVec({ lng: c.lng, lat: c.lat });
    let best = -1;
    let bestDot = 0.45;
    bubbles.forEach((b, i) => {
      const d = b.v[0] * view[0] + b.v[1] * view[1] + b.v[2] * view[2];
      if (d > bestDot) { bestDot = d; best = i; }
    });
    if (best !== shown) {
      bubbles.forEach((b, i) => {
        b.el.classList.toggle("is-visible", i === best);
        b.el.tabIndex = i === best ? 0 : -1;
        b.marker.getElement().style.zIndex = i === best ? "2" : "";
      });
      // A bubble that turns away folds back to its small size.
      if (expanded !== -1 && expanded !== best) setExpanded(-1);
      shown = best;
    }
  };
  updateBubbles();

  // Drag in any direction to turn the globe (no zoom). When left alone it
  // spins slowly and eases back to its starting tilt.
  container.style.touchAction = "none";
  const homeLat = centre[1];
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let vLng = 0; // degrees per second, for a little momentum
  let vLat = 0;
  let idleUntil = 0;
  const degPerPx = () => 180 / Math.max(120, container.clientWidth);
  const clampLat = (lat) => Math.max(-70, Math.min(70, lat));
  const turn = (dLng, dLat) => {
    const c = map.getCenter();
    map.setCenter([c.lng + dLng, clampLat(c.lat + dLat)]);
    updateBubbles();
  };
  container.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".score-bubble")) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    lastT = performance.now();
    vLng = 0;
    vLat = 0;
    container.setPointerCapture(event.pointerId);
  });
  container.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const now = performance.now();
    const dt = Math.max(0.001, (now - lastT) / 1000);
    const dLng = -(event.clientX - lastX) * degPerPx();
    const dLat = (event.clientY - lastY) * degPerPx();
    vLng = dLng / dt;
    vLat = dLat / dt;
    lastX = event.clientX;
    lastY = event.clientY;
    lastT = now;
    turn(dLng, dLat);
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    idleUntil = performance.now() + 2500;
  };
  container.addEventListener("pointerup", release);
  container.addEventListener("pointercancel", release);

  let frameId = null;
  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!dragging && !reducedMotion) {
      if (Math.abs(vLng) > 0.5 || Math.abs(vLat) > 0.5) {
        turn(vLng * dt, vLat * dt);
        const decay = Math.exp(-dt * 3);
        vLng *= decay;
        vLat *= decay;
      } else if (expanded === -1 && now > idleUntil) {
        const c = map.getCenter();
        turn(6 * dt, (homeLat - c.lat) * Math.min(1, dt * 0.8));
      }
    }
    frameId = requestAnimationFrame(tick);
  };
  frameId = requestAnimationFrame(tick);

  return {
    setColors: (next) => applyColors(map, next),
    destroy() {
      if (frameId) cancelAnimationFrame(frameId);
      space.destroy();
      map.remove();
    },
  };
}
