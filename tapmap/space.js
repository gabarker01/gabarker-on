// The sky behind TapMap's globe: stars, a faint Milky Way and the Moon, drawn on
// a canvas behind the map. The sky is fixed relative to the Earth and projected
// from the globe's camera, so it turns with you as you navigate. Every few
// seconds something passes: shooting stars and meteor showers, satellites and
// the ISS, comets, star flares, and rarer visitors (a UFO, a drifting
// astronaut, a red roadster). Tapping the Moon sends a rocket its way.

const rad = (d) => (d * Math.PI) / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const lngLatToVec = (lng, lat) => [
  Math.cos(rad(lat)) * Math.cos(rad(lng)),
  Math.cos(rad(lat)) * Math.sin(rad(lng)),
  Math.sin(rad(lat)),
];

// Small deterministic PRNG so everyone sees the same sky.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnit(rng) {
  const z = rng() * 2 - 1;
  const t = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), r * Math.sin(t), z];
}

const STAR_TINTS = ["255,255,255", "255,255,255", "255,255,255", "205,220,255", "255,236,210", "255,214,190"];

function buildSky() {
  const rng = mulberry32(20260924);
  const stars = [];
  for (let i = 0; i < 2400; i++) {
    const m = rng();
    stars.push({
      v: randomUnit(rng),
      size: 0.35 + m ** 3 * 1.5,
      alpha: 0.25 + m * 0.7,
      tint: STAR_TINTS[Math.floor(rng() * STAR_TINTS.length)],
      twinkle: rng() < 0.18 ? 0.6 + rng() * 2.2 : 0,
      phase: rng() * Math.PI * 2,
    });
  }
  // Milky Way: faint stars scattered about a tilted great circle.
  const pole = norm([0.3, -0.5, 0.8]);
  const a = norm([pole[1], -pole[0], 0]);
  const b = [pole[1] * a[2] - pole[2] * a[1], pole[2] * a[0] - pole[0] * a[2], pole[0] * a[1] - pole[1] * a[0]];
  for (let i = 0; i < 2600; i++) {
    const t = rng() * Math.PI * 2;
    const spread = (rng() + rng() + rng() - 1.5) * 0.16;
    const v = norm([
      Math.cos(t) * a[0] + Math.sin(t) * b[0] + spread * pole[0],
      Math.cos(t) * a[1] + Math.sin(t) * b[1] + spread * pole[1],
      Math.cos(t) * a[2] + Math.sin(t) * b[2] + spread * pole[2],
    ]);
    stars.push({ v, size: 0.3 + rng() * 0.45, alpha: 0.12 + rng() * 0.3, tint: "220,225,255", twinkle: 0, phase: 0 });
  }
  return stars;
}

function drawMoon(ctx, x, y, r) {
  ctx.save();
  const glow = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 3.2);
  glow.addColorStop(0, "rgba(235,232,220,0.16)");
  glow.addColorStop(1, "rgba(235,232,220,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  const face = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r * 1.05);
  face.addColorStop(0, "#f6f3ea");
  face.addColorStop(1, "#bdb7a8");
  ctx.fillStyle = face;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  // Maria and craters.
  ctx.fillStyle = "rgba(120,115,104,0.28)";
  for (const [cx, cy, cr] of [[-0.3, -0.2, 0.32], [0.18, -0.35, 0.2], [0.05, 0.15, 0.26], [0.38, 0.3, 0.14], [-0.35, 0.4, 0.12]]) {
    ctx.beginPath();
    ctx.arc(x + cx * r, y + cy * r, cr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Terminator shadow.
  const shade = ctx.createLinearGradient(x - r, y, x + r, y);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(0.62, "rgba(0,0,0,0.05)");
  shade.addColorStop(1, "rgba(0,0,0,0.62)");
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

// ---------- Easter eggs (screen space) ----------

const EGG_WEIGHTS = [
  ["shooting", 34], ["shower", 8], ["satellite", 18], ["iss", 8], ["flare", 10],
  ["comet", 8], ["ufo", 5], ["astronaut", 5], ["roadster", 4],
];
const EGG_TOTAL = EGG_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

function pickEgg(rng) {
  let roll = rng() * EGG_TOTAL;
  for (const [type, weight] of EGG_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return "shooting";
}

export function makeEgg(type, w, h, rng) {
  const edgeY = () => h * (0.08 + rng() * 0.5);
  switch (type) {
    case "shooting": {
      const x = w * (0.1 + rng() * 0.8);
      const y = h * (0.05 + rng() * 0.35);
      const angle = rad(20 + rng() * 40) * (rng() < 0.5 ? 1 : -1);
      return { type, x, y, dx: Math.cos(angle) * (rng() < 0.5 ? -1 : 1), dy: Math.abs(Math.sin(angle)), duration: 800, dist: 260 + rng() * 200 };
    }
    case "satellite": {
      const leftToRight = rng() < 0.5;
      const y0 = edgeY();
      return {
        type, x0: leftToRight ? -10 : w + 10, y0, x1: leftToRight ? w + 10 : -10, y1: y0 + (rng() - 0.5) * h * 0.5,
        duration: 14000 + rng() * 8000, flare: rng() < 0.35,
      };
    }
    case "comet": {
      const y0 = edgeY();
      return { type, x0: w + 40, y0, x1: w * 0.2, y1: y0 + h * 0.25, duration: 22000 };
    }
    case "iss": {
      const leftToRight = rng() < 0.5;
      const y0 = edgeY();
      return {
        type, x0: leftToRight ? -20 : w + 20, y0, x1: leftToRight ? w + 20 : -20, y1: y0 + (rng() - 0.5) * h * 0.3,
        duration: 11000 + rng() * 4000,
      };
    }
    case "flare": {
      return { type, x: w * (0.08 + rng() * 0.84), y: h * (0.06 + rng() * 0.5), duration: 2400 };
    }
    case "astronaut": {
      const y0 = h * (0.12 + rng() * 0.45);
      const leftToRight = rng() < 0.5;
      return { type, x0: leftToRight ? -20 : w + 20, y0, x1: leftToRight ? w + 20 : -20, y1: y0 + (rng() - 0.5) * 60, duration: 16000, spin: (rng() < 0.5 ? -1 : 1) * (0.6 + rng()) };
    }
    case "roadster": {
      const y0 = h * (0.1 + rng() * 0.4);
      return { type, x0: w + 30, y0, x1: -30, y1: y0 + 30, duration: 14000 };
    }
    default: {
      const y0 = h * (0.15 + rng() * 0.4);
      return { type: "ufo", x0: -30, y0, x1: w + 30, y1: y0 - 40 + rng() * 80, duration: 3200 };
    }
  }
}

export function drawEgg(ctx, egg, t) {
  const p = Math.min(1, t / egg.duration);
  ctx.save();
  if (egg.type === "shooting") {
    const e = 1 - (1 - p) ** 2;
    const hx = egg.x + egg.dx * egg.dist * e;
    const hy = egg.y + egg.dy * egg.dist * e;
    const tail = 90 * Math.sin(Math.PI * p);
    const g = ctx.createLinearGradient(hx, hy, hx - egg.dx * tail, hy - egg.dy * tail);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - p)})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - egg.dx * tail, hy - egg.dy * tail);
    ctx.stroke();
  } else if (egg.type === "satellite") {
    const x = egg.x0 + (egg.x1 - egg.x0) * p;
    const y = egg.y0 + (egg.y1 - egg.y0) * p;
    let a = 0.55 * Math.min(1, p * 8, (1 - p) * 8);
    let size = 1.1;
    if (egg.flare) {
      const f = Math.exp(-(((p - 0.5) / 0.035) ** 2));
      a = Math.min(1, a + f);
      size += f * 2.2;
    }
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  } else if (egg.type === "comet") {
    const x = egg.x0 + (egg.x1 - egg.x0) * p;
    const y = egg.y0 + (egg.y1 - egg.y0) * p;
    const a = Math.min(1, p * 6, (1 - p) * 6);
    const g = ctx.createLinearGradient(x, y, x + 110, y - 22);
    g.addColorStop(0, `rgba(190,225,255,${0.5 * a})`);
    g.addColorStop(1, "rgba(190,225,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y - 1.5);
    ctx.lineTo(x + 110, y - 30);
    ctx.lineTo(x + 115, y - 12);
    ctx.lineTo(x, y + 1.5);
    ctx.fill();
    ctx.fillStyle = `rgba(230,245,255,${0.9 * a})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (egg.type === "ufo") {
    const x = egg.x0 + (egg.x1 - egg.x0) * p;
    const y = egg.y0 + (egg.y1 - egg.y0) * p + Math.sin(p * Math.PI * 6) * 6;
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(170,255,210,0.55)";
    ctx.beginPath();
    ctx.ellipse(0, -2.5, 3.2, 3, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "rgba(200,205,215,0.9)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,230,140,0.9)";
    for (const lx of [-4.5, 0, 4.5]) {
      ctx.beginPath();
      ctx.arc(lx, 0.4, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (egg.type === "iss") {
    const x = egg.x0 + (egg.x1 - egg.x0) * p;
    const y = egg.y0 + (egg.y1 - egg.y0) * p;
    ctx.globalAlpha = Math.min(1, p * 8, (1 - p) * 8);
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(egg.y1 - egg.y0, egg.x1 - egg.x0));
    ctx.fillStyle = "rgba(150,170,210,0.9)";
    ctx.fillRect(-7, -3.2, 5, 2.2);
    ctx.fillRect(-7, 1, 5, 2.2);
    ctx.fillRect(2, -3.2, 5, 2.2);
    ctx.fillRect(2, 1, 5, 2.2);
    ctx.fillStyle = "rgba(245,245,240,0.95)";
    ctx.fillRect(-2, -1, 4, 2);
    ctx.fillRect(-0.4, -3.4, 0.8, 6.8);
    ctx.fillStyle = `rgba(255,90,80,${0.5 + 0.5 * Math.sin(t / 160)})`;
    ctx.beginPath();
    ctx.arc(2.3, 0, 0.7, 0, Math.PI * 2);
    ctx.fill();
  } else if (egg.type === "flare") {
    const a = Math.sin(Math.PI * p) ** 2;
    const r = 1.2 + a * 3;
    ctx.globalAlpha = a;
    ctx.strokeStyle = "rgba(220,235,255,0.8)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(egg.x - r * 3.5, egg.y); ctx.lineTo(egg.x + r * 3.5, egg.y);
    ctx.moveTo(egg.x, egg.y - r * 3.5); ctx.lineTo(egg.x, egg.y + r * 3.5);
    ctx.stroke();
    const g = ctx.createRadialGradient(egg.x, egg.y, 0, egg.x, egg.y, r * 2.5);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(200,220,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(egg.x, egg.y, r * 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (egg.type === "astronaut") {
    const x = egg.x0 + (egg.x1 - egg.x0) * p;
    const y = egg.y0 + (egg.y1 - egg.y0) * p + Math.sin(p * Math.PI * 2) * 10;
    ctx.globalAlpha = Math.min(1, p * 10, (1 - p) * 10);
    ctx.translate(x, y);
    ctx.rotate((t / 1000) * egg.spin);
    ctx.fillStyle = "#e9e6de";
    ctx.beginPath();
    ctx.arc(0, -4.2, 2.6, 0, Math.PI * 2); // helmet
    ctx.fill();
    ctx.fillRect(-2.4, -2, 4.8, 5); // body
    ctx.fillRect(-4.2, -1.4, 1.8, 3.6); // arms
    ctx.fillRect(2.4, -1.4, 1.8, 3.6);
    ctx.fillRect(-2.2, 3, 1.8, 3.2); // legs
    ctx.fillRect(0.4, 3, 1.8, 3.2);
    ctx.fillStyle = "#d9b26a";
    ctx.beginPath();
    ctx.arc(0.5, -4.4, 1.5, 0, Math.PI * 2); // visor
    ctx.fill();
  } else if (egg.type === "roadster") {
    const x = egg.x0 + (egg.x1 - egg.x0) * p;
    const y = egg.y0 + (egg.y1 - egg.y0) * p;
    ctx.globalAlpha = Math.min(1, p * 10, (1 - p) * 10);
    ctx.translate(x, y);
    ctx.rotate(-0.25 + Math.sin(t / 900) * 0.15);
    ctx.fillStyle = "#c8323a";
    ctx.beginPath();
    ctx.moveTo(-8, 1); ctx.lineTo(-7, -1.5); ctx.lineTo(-2, -2.2); ctx.lineTo(1, -4); ctx.lineTo(5, -4);
    ctx.lineTo(8, -1.2); ctx.lineTo(8, 1); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1b1d22";
    for (const wx of [-5, 5]) {
      ctx.beginPath();
      ctx.arc(wx, 1.4, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#f1ece2"; // Starman
    ctx.beginPath();
    ctx.arc(2.6, -5.6, 1.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (egg.type === "rocket") {
    const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
    const x = egg.x0 + (egg.x1 - egg.x0) * e;
    const y = egg.y0 + (egg.y1 - egg.y0) * e - Math.sin(Math.PI * e) * 40;
    const angle = Math.atan2(egg.y1 - egg.y0, egg.x1 - egg.x0);
    const fade = Math.min(1, (1 - p) * 10);
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = fade;
    ctx.fillStyle = "rgba(255,170,80,0.85)";
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(-11 - Math.random() * 4, 0);
    ctx.lineTo(-5, 1.6);
    ctx.lineTo(-5, -1.6);
    ctx.fill();
    ctx.fillStyle = "#f1ece2";
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-5, 2.2);
    ctx.lineTo(-5, -2.2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  return p >= 1;
}

// ---------- Public ----------

export function createSpace(container, map, { reducedMotion = false, eggs = true } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "space";
  canvas.setAttribute("aria-hidden", "true");
  container.prepend(canvas);
  const ctx = canvas.getContext("2d");
  const stars = buildSky();
  const rng = () => Math.random();

  let width = 0;
  let height = 0;
  let dpr = 1;
  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = container.clientWidth;
    height = container.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  };
  new ResizeObserver(resize).observe(container);
  resize();

  const camera = () => {
    const c = map.getCenter();
    const P = lngLatToVec(c.lng, c.lat);
    const f = [-P[0], -P[1], -P[2]];
    const east = [-Math.sin(rad(c.lng)), Math.cos(rad(c.lng)), 0];
    const north = norm([
      -Math.sin(rad(c.lat)) * Math.cos(rad(c.lng)),
      -Math.sin(rad(c.lat)) * Math.sin(rad(c.lng)),
      Math.cos(rad(c.lat)),
    ]);
    const focal = Math.max(width, height) * 0.5 * (1 + 0.04 * Math.max(0, map.getZoom()));
    return { f, east, north, focal };
  };

  // Place the Moon up and to the right of the globe in the starting view.
  const start = camera();
  const mx = (width * 0.84 - width / 2) / start.focal;
  const my = (height / 2 - height * 0.25) / start.focal;
  const moonDir = norm([
    start.f[0] + mx * start.east[0] + my * start.north[0],
    start.f[1] + mx * start.east[1] + my * start.north[1],
    start.f[2] + mx * start.east[2] + my * start.north[2],
  ]);

  const project = (v, cam) => {
    const depth = dot(v, cam.f);
    if (depth <= 0.05) return null;
    return [
      width / 2 + (dot(v, cam.east) / depth) * cam.focal,
      height / 2 - (dot(v, cam.north) / depth) * cam.focal,
    ];
  };

  let moonScreen = null;
  let active = [];
  let nextEggAt = performance.now() + 2500 + rng() * 3000;

  function frame(now) {
    const cam = camera();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    for (const s of stars) {
      const p = project(s.v, cam);
      if (!p || p[0] < -2 || p[1] < -2 || p[0] > width + 2 || p[1] > height + 2) continue;
      let a = s.alpha;
      if (s.twinkle && !reducedMotion) a *= 0.75 + 0.25 * Math.sin(now / 1000 * s.twinkle + s.phase);
      ctx.fillStyle = `rgba(${s.tint},${a})`;
      if (s.size < 0.8) {
        ctx.fillRect(p[0], p[1], s.size * 1.4, s.size * 1.4);
      } else {
        ctx.beginPath();
        ctx.arc(p[0], p[1], s.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const m = project(moonDir, cam);
    const moonR = Math.max(9, Math.min(26, cam.focal * 0.045));
    moonScreen = m ? { x: m[0], y: m[1], r: moonR } : null;
    if (m) drawMoon(ctx, m[0], m[1], moonR);

    if (eggs && !reducedMotion) {
      if (now >= nextEggAt && active.length < 3) {
        const type = pickEgg(rng);
        if (type === "shower") {
          // A little meteor shower: several shooting stars from one direction.
          const lead = makeEgg("shooting", width, height, rng);
          for (let k = 0; k < 4 + Math.floor(rng() * 3); k++) {
            active.push({
              ...lead,
              x: lead.x + (rng() - 0.5) * width * 0.5,
              y: lead.y + (rng() - 0.5) * height * 0.2,
              dist: lead.dist * (0.6 + rng() * 0.5),
              start: now + k * (180 + rng() * 260),
            });
          }
        } else {
          active.push({ ...makeEgg(type, width, height, rng), start: now });
        }
        nextEggAt = now + 3000 + rng() * 6000;
      }
      active = active.filter((egg) => now < egg.start || !drawEgg(ctx, egg, now - egg.start));
    }

    raf = requestAnimationFrame(frame);
  }

  let raf = requestAnimationFrame(frame);

  return {
    // Returns true if (x, y) hit the Moon, and launches a rocket at it.
    tap(x, y) {
      if (!moonScreen || Math.hypot(x - moonScreen.x, y - moonScreen.y) > moonScreen.r * 1.6) return false;
      if (reducedMotion) return true;
      const fromLeft = moonScreen.x > width / 2;
      active.push({
        type: "rocket", start: performance.now(), duration: 2600,
        x0: fromLeft ? width * 0.35 : width * 0.65, y0: height * 0.55,
        x1: moonScreen.x, y1: moonScreen.y,
      });
      return true;
    },
    destroy() {
      cancelAnimationFrame(raf);
      canvas.remove();
    },
  };
}
