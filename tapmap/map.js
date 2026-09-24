// Pan/zoom world map for TapMap, drawn with D3 (global `d3`) as SVG.
//
// The map is a Web Mercator projection whose horizontal pan is applied as a
// rotation, so it wraps endlessly east–west. Arcs are geodesics drawn by
// d3.geoPath, and before a reveal the view is centred on the arc's midpoint,
// so a guess in Alaska for Fiji arcs across the Pacific, not across the globe.

const MAX_ZOOM = 64;
const FIT_MAX_ZOOM = 10;
const MAX_LAT = 85;
const deg = (rad) => (rad * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;
const mercY = (lat) => -Math.log(Math.tan(Math.PI / 4 + rad(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))) / 2));

const PIN_PATH = "M0 0C-2-7-10-11-10-19a10 10 0 0 1 20 0c0 8-8 12-10 19z";

export function createMap(svgElement, world, { onTap, reducedMotion = false } = {}) {
  const svg = d3.select(svgElement);
  const land = topojson.feature(world, world.objects.land || world.objects.countries);
  const borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);

  const projection = d3.geoMercator();
  const path = d3.geoPath(projection);

  const graticulePath = svg.append("path").attr("class", "graticule").datum(d3.geoGraticule10());
  const landPath = svg.append("path").attr("class", "land").datum(land);
  const borderPath = svg.append("path").attr("class", "borders").datum(borders);
  const arcLayer = svg.append("g").attr("class", "arcs");
  const pinLayer = svg.append("g").attr("class", "pins");

  let width = 0;
  let height = 0;
  let baseScale = 1; // world width = viewport width at zoom 1
  let transform = d3.zoomIdentity;
  let arcs = []; // { from, to, progress, el }
  let pins = []; // { lnglat, el }

  const zoom = d3.zoom()
    .scaleExtent([1, MAX_ZOOM])
    .clickDistance(8)
    .tapDistance(12)
    .on("zoom", (event) => {
      transform = event.transform;
      render();
    });

  svg.call(zoom).on("dblclick.zoom", null);

  // A click or tap that wasn't a drag places a pin.
  svg.on("click", (event) => {
    if (event.defaultPrevented || !onTap) return;
    const [x, y] = d3.pointer(event, svgElement);
    const topY = transform.y - Math.PI * baseScale * transform.k;
    const bottomY = transform.y + Math.PI * baseScale * transform.k;
    if (y < topY || y > bottomY) return;
    const [lng, lat] = projection.invert([x, y]);
    onTap({ lng: wrapLng(lng), lat: Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) });
  });

  // ---------- Rendering ----------

  function applyTransform() {
    const scale = baseScale * transform.k;
    const rotation = wrapLng(deg((transform.x - width / 2) / scale));
    projection.scale(scale).translate([width / 2, transform.y]).rotate([rotation, 0]);
  }

  function arcCoordinates(arc) {
    if (arc.progress >= 1) return [[arc.from.lng, arc.from.lat], [arc.to.lng, arc.to.lat]];
    const interpolate = d3.geoInterpolate([arc.from.lng, arc.from.lat], [arc.to.lng, arc.to.lat]);
    return [[arc.from.lng, arc.from.lat], interpolate(Math.max(0.0001, arc.progress))];
  }

  function render() {
    if (!width) return;
    applyTransform();
    graticulePath.attr("d", path);
    landPath.attr("d", path);
    borderPath.attr("d", path);
    for (const arc of arcs) {
      arc.el.attr("d", path({ type: "LineString", coordinates: arcCoordinates(arc) }));
    }
    for (const pin of pins) {
      const [x, y] = projection([pin.lnglat.lng, pin.lnglat.lat]);
      pin.el.attr("transform", `translate(${x},${y})`);
    }
  }

  function resize() {
    const rect = svgElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Resetting the transform interrupts any running fit, so only do it on a real change.
    if (rect.width === width && rect.height === height) return;
    const centre = width ? centreLngLat() : null;
    width = rect.width;
    height = rect.height;
    baseScale = width / (2 * Math.PI);
    zoom
      .extent([[0, 0], [width, height]])
      .translateExtent([[-Infinity, -Math.PI * baseScale], [Infinity, Math.PI * baseScale]]);
    const target = centre ? viewFor(centre, transform.k) : initialTransform();
    svg.call(zoom.transform, target);
  }

  // ---------- View helpers ----------

  function centreLngLat() {
    const scale = baseScale * transform.k;
    return {
      lng: deg((width / 2 - transform.x) / scale),
      lat: deg(2 * Math.atan(Math.exp(-(height / 2 - transform.y) / scale)) - Math.PI / 2),
    };
  }

  // Transform that puts `lnglat` at screen point (cx, cy) at zoom k.
  function viewFor(lnglat, k, cx = width / 2, cy = height / 2) {
    return d3.zoomIdentity
      .translate(cx - k * baseScale * rad(lnglat.lng), cy - k * baseScale * mercY(lnglat.lat))
      .scale(k);
  }

  function initialTransform() {
    // Whole world width on narrow screens; a little closer on wide ones.
    const k = Math.max(1, Math.min(1.6, height / width));
    return viewFor({ lng: 10, lat: 25 }, k);
  }

  function transition(target, duration = 750) {
    if (reducedMotion || !duration) {
      svg.interrupt().call(zoom.transform, target);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      svg.interrupt()
        .transition()
        .duration(duration)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, target)
        .on("end interrupt", resolve);
    });
  }

  // Fit the view around a set of arcs (and their end points).
  function fitArcs(pairs, padding) {
    const samples = [];
    for (const [a, b] of pairs) {
      const interpolate = d3.geoInterpolate([a.lng, a.lat], [b.lng, b.lat]);
      for (let i = 0; i <= 32; i++) samples.push(interpolate(i / 32));
    }
    // Measure longitudes relative to the first arc's midpoint so the fit never
    // straddles the antimeridian the wrong way.
    const [a0, b0] = pairs[0];
    const refLng = d3.geoInterpolate([a0.lng, a0.lat], [b0.lng, b0.lat])(0.5)[0];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [lng, lat] of samples) {
      const x = rad(wrapLng(lng - refLng));
      const y = mercY(lat);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const availW = Math.max(40, width - padding.left - padding.right);
    const availH = Math.max(40, height - padding.top - padding.bottom);
    const spanX = (maxX - minX) * baseScale;
    const spanY = (maxY - minY) * baseScale;
    const k = Math.max(1, Math.min(
      FIT_MAX_ZOOM,
      spanX ? availW / spanX : FIT_MAX_ZOOM,
      spanY ? availH / spanY : FIT_MAX_ZOOM,
    ));

    // Centre, in absolute longitude, nearest to the current view to avoid long spins.
    let centreLng = refLng + deg((minX + maxX) / 2);
    const currentLng = centreLngLat().lng;
    centreLng += 360 * Math.round((currentLng - centreLng) / 360);
    const centreLat = deg(2 * Math.atan(Math.exp(-(minY + maxY) / 2)) - Math.PI / 2);

    const cx = padding.left + availW / 2;
    const cy = padding.top + availH / 2;
    return transition(viewFor({ lng: centreLng, lat: centreLat }, k, cx, cy), 900);
  }

  // ---------- Pins & arcs ----------

  function addPin(lnglat, kind) {
    const el = pinLayer.append("g").attr("class", `pin pin-${kind}`);
    const drop = el.append("g").attr("class", reducedMotion ? "pin-body" : "pin-body pin-drop");
    drop.append("ellipse").attr("class", "pin-shadow").attr("rx", 5).attr("ry", 2);
    drop.append("path").attr("d", PIN_PATH);
    drop.append("circle").attr("cy", -19).attr("r", 4).attr("class", "pin-dot");
    const pin = { lnglat, el };
    pins.push(pin);
    render();
    return pin;
  }

  let guessPin = null;

  function setGuess(lnglat) {
    if (guessPin) {
      guessPin.lnglat = lnglat;
      // Replay the drop animation when the pin moves.
      const body = guessPin.el.select(".pin-body");
      body.classed("pin-drop", false);
      void body.node().getBBox();
      body.classed("pin-drop", !reducedMotion);
      render();
    } else {
      guessPin = addPin(lnglat, "guess");
    }
  }

  function animateArc(arc, duration) {
    if (reducedMotion) {
      arc.progress = 1;
      render();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = d3.timer((elapsed) => {
        arc.progress = d3.easeCubicOut(Math.min(1, elapsed / duration));
        render();
        if (elapsed >= duration) {
          timer.stop();
          resolve();
        }
      });
    });
  }

  async function reveal(guess, answer, padding) {
    const arc = { from: guess, to: answer, progress: 0, el: arcLayer.append("path").attr("class", "arc") };
    arcs.push(arc);
    await fitArcs([[guess, answer]], padding);
    await animateArc(arc, 900);
    addPin(answer, "answer");
  }

  function clear() {
    arcLayer.selectAll("*").remove();
    pinLayer.selectAll("*").remove();
    arcs = [];
    pins = [];
    guessPin = null;
  }

  function reset() {
    clear();
    return transition(initialTransform(), 600);
  }

  function zoomBy(factor) {
    svg.interrupt().transition().duration(reducedMotion ? 0 : 250).call(zoom.scaleBy, factor);
  }

  new ResizeObserver(resize).observe(svgElement);
  resize();

  return { setGuess, reveal, reset, clear, zoomBy, resize };
}

// Static overview map of every round's arc, for the results screen.
export function drawSummaryMap(svgElement, world, rounds) {
  const svg = d3.select(svgElement);
  svg.selectAll("*").remove();
  const width = 360;
  const height = 190;
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  // Choose the rotation that splits the fewest arcs at the map edge.
  const lines = rounds.map((r) => [[r.guess.lng, r.guess.lat], [r.answer.lng, r.answer.lat]]);
  const crossings = (rotation) => lines.reduce((count, [a, b]) => {
    const interpolate = d3.geoInterpolate(a, b);
    let prev = wrapLng(a[0] + rotation);
    for (let i = 1; i <= 24; i++) {
      const lng = wrapLng(interpolate(i / 24)[0] + rotation);
      if (Math.abs(lng - prev) > 180) return count + 1;
      prev = lng;
    }
    return count;
  }, 0);
  let bestRotation = 0;
  let bestCount = crossings(0);
  for (let r = 10; r <= 180 && bestCount; r += 10) {
    for (const candidate of [r, -r]) {
      const c = crossings(candidate);
      if (c < bestCount) { bestCount = c; bestRotation = candidate; }
    }
  }

  const projection = d3.geoNaturalEarth1().rotate([bestRotation, 0]).fitSize([width, height], { type: "Sphere" });
  const path = d3.geoPath(projection);
  const land = topojson.feature(world, world.objects.land || world.objects.countries);

  svg.append("path").attr("class", "sphere").attr("d", path({ type: "Sphere" }));
  svg.append("path").attr("class", "land").attr("d", path(land));
  lines.forEach((line, i) => {
    svg.append("path")
      .attr("class", "arc")
      .attr("pathLength", 1)
      .style("animation-delay", `${i * 150}ms`)
      .attr("d", path({ type: "LineString", coordinates: line }));
  });
  for (const [guess, answer] of lines) {
    const [gx, gy] = projection(guess);
    const [ax, ay] = projection(answer);
    svg.append("circle").attr("class", "dot-guess").attr("cx", gx).attr("cy", gy).attr("r", 2.5);
    svg.append("circle").attr("class", "dot-answer").attr("cx", ax).attr("cy", ay).attr("r", 3);
  }
}
