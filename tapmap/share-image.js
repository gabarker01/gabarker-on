// Draws a finished game as a PNG: the guesses and answers on a globe, with
// the score. Drawn on a 2D canvas (not read back from the WebGL globe), so it
// works the same on every browser.

const LAND_URL = new URL("./land-110m.geojson?v=1", import.meta.url);
const WIDTH = 1080;
const HEIGHT = 1350;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const vec = ({ lat, lng }) => [Math.cos(rad(lat)) * Math.cos(rad(lng)), Math.cos(rad(lat)) * Math.sin(rad(lng)), Math.sin(rad(lat))];

let landPromise = null;
const loadLand = () => {
  landPromise ||= fetch(LAND_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return landPromise;
};

// The view centre: the average direction of every guess and answer.
function centreOf(points) {
  const sum = points.map(vec).reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]);
  const len = Math.hypot(...sum);
  if (len < 1e-6) return { lat: 20, lng: 0 };
  return { lat: deg(Math.asin(sum[2] / len)), lng: deg(Math.atan2(sum[1], sum[0])) };
}

// Orthographic projection. Points on the far side are pushed onto the edge,
// which keeps filled land shapes tidy along the horizon.
function projector(centre, cx, cy, r) {
  const phi0 = rad(centre.lat);
  const lam0 = rad(centre.lng);
  return ({ lat, lng }) => {
    const phi = rad(lat);
    const dl = rad(lng) - lam0;
    const x = Math.cos(phi) * Math.sin(dl);
    const y = Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(dl);
    const front = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(dl);
    if (front >= 0) return { x: cx + r * x, y: cy - r * y, front: true };
    const len = Math.hypot(x, y) || 1;
    return { x: cx + (r * x) / len, y: cy - (r * y) / len, front: false };
  };
}

// Points along the great circle from a to b.
function arc(a, b, steps = 64) {
  const va = vec(a);
  const vb = vec(b);
  const omega = Math.acos(Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const k1 = omega < 1e-9 ? 1 - t : Math.sin((1 - t) * omega) / Math.sin(omega);
    const k2 = omega < 1e-9 ? t : Math.sin(t * omega) / Math.sin(omega);
    const v = [k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]];
    out.push({ lat: deg(Math.asin(Math.max(-1, Math.min(1, v[2] / Math.hypot(...v))))), lng: deg(Math.atan2(v[1], v[0])) });
  }
  return out;
}

function ringPath(ctx, ring, project) {
  ring.forEach(([lng, lat], i) => {
    const p = project({ lat, lng });
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}

// A few fixed stars (seeded, so every image looks the same).
function stars(ctx) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 160; i++) {
    ctx.globalAlpha = 0.15 + rnd() * 0.55;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(rnd() * WIDTH, rnd() * HEIGHT, 0.6 + rnd() * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// { title, total, max, ratingText, rounds: [{ guess, answer, tier, score }],
//   colors: { ink, soft, faint, accent, ocean, land, atmosphere, tiers: { "🎯": "#…", … } }, url }
export async function drawShareImage({ title, total, max, ratingText, rounds, colors, url }) {
  const land = await loadLand();
  if (document.fonts && document.fonts.load) {
    await Promise.all([
      document.fonts.load('400 120px "Instrument Serif"'),
      document.fonts.load('500 36px "Geist"'),
    ]).catch(() => {});
  }
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  const serif = '"Instrument Serif", Georgia, serif';
  const sans = '"Geist", system-ui, -apple-system, sans-serif';

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  stars(ctx);

  // Header
  ctx.textAlign = "center";
  ctx.fillStyle = colors.soft;
  ctx.font = `500 30px ${sans}`;
  ctx.fillText(title.toUpperCase().split("").join(String.fromCharCode(8202)), WIDTH / 2, 110);
  ctx.fillStyle = colors.ink;
  ctx.font = `400 150px ${serif}`;
  const totalText = total.toLocaleString("en-US");
  ctx.fillText(totalText, WIDTH / 2 - 60, 260);
  const totalWidth = ctx.measureText(totalText).width;
  ctx.textAlign = "left";
  ctx.fillStyle = colors.faint;
  ctx.font = `400 48px ${serif}`;
  ctx.fillText(`of ${max.toLocaleString("en-US")}`, WIDTH / 2 - 60 + totalWidth / 2 + 16, 260);
  ctx.textAlign = "center";
  ctx.fillStyle = colors.accent;
  ctx.font = `italic 400 50px ${serif}`;
  ctx.fillText(ratingText, WIDTH / 2, 330);

  // Globe
  const cx = WIDTH / 2;
  const cy = 745;
  const r = 330;
  const points = rounds.flatMap((round) => [round.guess, round.answer]);
  const project = projector(centreOf(points), cx, cy, r);

  const halo = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.25);
  halo.addColorStop(0, `${colors.atmosphere}88`);
  halo.addColorStop(1, `${colors.atmosphere}00`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.25, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const ocean = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  ocean.addColorStop(0, "#1b2d45");
  ocean.addColorStop(1, colors.ocean);
  ctx.fillStyle = ocean;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  if (land && land.features) {
    ctx.fillStyle = colors.land;
    ctx.beginPath();
    for (const feature of land.features) {
      const g = feature.geometry;
      if (!g) continue;
      const polygons = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      for (const polygon of polygons) {
        // Skip shapes entirely on the far side.
        if (!polygon[0].some(([lng, lat]) => project({ lat, lng }).front)) continue;
        for (const ring of polygon) ringPath(ctx, ring, project);
      }
    }
    ctx.fill("evenodd");
  }
  // Arcs (front side only) and pins.
  ctx.lineCap = "round";
  const strokeFront = (path) => {
    ctx.beginPath();
    let drawing = false;
    for (const p of path) {
      if (!p.front) { drawing = false; continue; }
      if (drawing) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      drawing = true;
    }
    ctx.stroke();
  };
  for (const round of rounds) {
    const path = arc(round.guess, round.answer).map(project);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 7;
    strokeFront(path);
    ctx.strokeStyle = colors.tiers[round.tier] || colors.accent;
    ctx.lineWidth = 4;
    strokeFront(path);
  }
  for (const round of rounds) {
    const g = project(round.guess);
    const a = project(round.answer);
    if (g.front) {
      ctx.fillStyle = colors.ink;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    if (a.front) {
      ctx.fillStyle = colors.tiers[round.tier] || colors.accent;
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  // A soft terminator for depth.
  const shade = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.4, r * 0.2, cx, cy, r * 1.05);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = shade;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  // Round scores
  const slot = 150;
  const startX = WIDTH / 2 - (slot * (rounds.length - 1)) / 2;
  rounds.forEach((round, i) => {
    const x = startX + i * slot;
    ctx.fillStyle = colors.tiers[round.tier] || colors.accent;
    ctx.beginPath();
    ctx.arc(x, 1140, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.ink;
    ctx.font = `400 58px ${serif}`;
    ctx.fillText(String(round.score), x, 1215);
  });

  ctx.fillStyle = colors.faint;
  ctx.font = `500 28px ${sans}`;
  ctx.fillText(url.replace(/^https?:\/\//, ""), WIDTH / 2, 1295);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't draw the image"))), "image/png"));
}
