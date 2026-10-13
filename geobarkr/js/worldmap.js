// Small world maps drawn in the browser (no Google Maps): the bands on pages
// without Street View and the game thumbnails. Same projection as Google Maps
// (Web Mercator). Coastlines come from the file TapMap already serves.
import { mercator, greatCircle } from "./geo.js?v=12";

const LAND_URL = "/tapmap/land-110m.geojson";
const SIZE = 1000; // the world is SIZE × SIZE in map units
let landPromise = null;

// One shared <symbol> with every coastline, reused by each map with <use>.
function landSymbol() {
  if (!landPromise) {
    landPromise = fetch(LAND_URL).then((r) => r.json()).then((geo) => {
      let d = "";
      for (const feature of geo.features) {
        const g = feature.geometry;
        const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
        for (const polygon of polygons) for (const ring of polygon) {
          if (Math.min(...ring.map((p) => p[1])) < -60) continue; // Antarctica wraps the date line
          let prev = null;
          let shift = 0;
          d += ring.map(([lng, lat], i) => {
            if (prev != null && lng + shift - prev > 180) shift -= 360;
            else if (prev != null && lng + shift - prev < -180) shift += 360;
            prev = lng + shift;
            const [x, y] = mercator(lat, prev);
            return `${i ? "L" : "M"}${(x * SIZE).toFixed(1)} ${(y * SIZE).toFixed(1)}`;
          }).join("") + "Z";
        }
      }
      const holder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      holder.setAttribute("width", "0");
      holder.setAttribute("height", "0");
      holder.style.position = "absolute";
      holder.innerHTML = `<defs><symbol id="gb-land" viewBox="0 0 ${SIZE} ${SIZE}"><path d="${d}"/></symbol></defs>`;
      document.body.prepend(holder);
    });
  }
  return landPromise;
}

const pt = (lat, lng) => mercator(lat, lng).map((v) => v * SIZE);

// Draw a world map into `el`. view: { lat, lng, zoom } (zoom 0 = whole world
// across the box). arcs: [{ from, to, colour, width }]; dots: [{ lat, lng, colour, r }].
export async function drawWorld(el, { view = { lat: 20, lng: 10, zoom: 0 }, arcs = [], dots = [], grid = true, className = "" } = {}) {
  await landSymbol();
  const w = el.clientWidth || 390;
  const h = el.clientHeight || 200;
  const span = SIZE / 2 ** view.zoom; // map units across the box
  const [cx, cy] = pt(view.lat, view.lng);
  const vw = span;
  const vh = (span * h) / w;
  const x0 = cx - vw / 2;
  const y0 = Math.max(0, Math.min(SIZE - vh, cy - vh / 2));
  const unit = vw / w; // map units per pixel, so strokes stay the same on screen
  let svg = `<svg class="gb-world ${className}" viewBox="${x0} ${y0} ${vw} ${vh}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">`;
  svg += `<rect x="${x0}" y="${y0}" width="${vw}" height="${vh}" class="gb-world-sea"/>`;
  if (grid) {
    let lines = "";
    for (let lng = -180; lng <= 180; lng += 20) { const [x] = pt(0, lng); lines += `M${x} ${y0}V${y0 + vh}`; }
    for (let lat = -60; lat <= 80; lat += 20) { const [, y] = pt(lat, 0); lines += `M${x0} ${y}H${x0 + vw}`; }
    svg += `<path d="${lines}" class="gb-world-grid" stroke-width="${unit}"/>`;
  }
  // Repeat the world sideways when the box is wider than it.
  for (const dx of [-SIZE, 0, SIZE]) {
    if (x0 + vw < dx || x0 > dx + SIZE) continue;
    svg += `<use href="#gb-land" x="${dx}" y="0" width="${SIZE}" height="${SIZE}" class="gb-world-land" stroke-width="${unit * 0.8}"/>`;
  }
  for (const arc of arcs) {
    const d = greatCircle(arc.from, arc.to, 48).map((p, i) => { const [x, y] = pt(p.lat, p.lng); return `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`; }).join("");
    svg += `<path d="${d}" fill="none" stroke="${arc.colour}" stroke-width="${(arc.width || 2) * unit}" stroke-linecap="round" opacity="${arc.opacity ?? 1}"/>`;
  }
  for (const dot of dots) {
    const [x, y] = pt(dot.lat, dot.lng);
    svg += `<circle cx="${x}" cy="${y}" r="${(dot.r || 3.5) * unit}" fill="${dot.colour}" stroke="${dot.stroke || "var(--water)"}" stroke-width="${(dot.strokeWidth || 1.4) * unit}"/>`;
  }
  svg += "</svg>";
  // Replace only the map, keeping anything else in el (captions over the band).
  el.querySelector(":scope > svg.gb-world")?.remove();
  el.insertAdjacentHTML("afterbegin", svg);
}
