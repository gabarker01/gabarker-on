// Formatting shared by the pages (and tested in geobarkr/tests). Distances and
// scores themselves are worked out in the database.

// "3min 12s" or "12s", as ServiceNow's _formatTimeField.
export function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}min ${seconds}s` : `${seconds}s`;
}

// Whole km from 10 km up, otherwise 0.1 km (calculateDistanceBetweenPoints).
export function roundDistance(km) {
  const d = Number(km) || 0;
  return d >= 10 ? Math.round(d) : Math.round(d * 10) / 10;
}

export function formatDistance(km) {
  return roundDistance(km).toLocaleString("en-GB");
}

export function formatScore(score) {
  return Math.floor(Number(score) || 0).toLocaleString("en-GB");
}

// 1 → "1st", 2 → "2nd", 11 → "11th".
export function ordinal(n) {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${suffix}`;
}

export const GAME_TYPES = {
  single_player: "Single player",
  multiplayer: "Multiplayer",
  local_multiplayer: "In person",
};

export const GAME_STATUSES = {
  lobby: "Lobby",
  in_play: "In play",
  complete: "Complete",
  cancelled: "Cancelled",
};

export function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// "George Barker" → "George".
export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";

// The place and view in a Google Maps Street View link, for the admin page, e.g.
// https://www.google.com/maps/@48.8583,2.2945,3a,75y,250h,90t/…  (pitch = t − 90)
export function parseStreetViewLink(link) {
  const match = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)((?:,[^,/]+)*)/.exec(String(link));
  if (!match) return null;
  const segment = (suffix) => match[3].split(",").find((part) => new RegExp(`^\\d+(?:\\.\\d+)?${suffix}$`).test(part));
  const heading = segment("h");
  const tilt = segment("t");
  return {
    lat: Number(match[1]),
    lng: Number(match[2]),
    heading: heading == null ? 0 : parseFloat(heading) % 360,
    pitch: tilt == null ? 0 : Math.max(-90, Math.min(90, parseFloat(tilt) - 90)),
  };
}

// ---------- Distances and scores (the same formulas as the database, for demo mode) ----------

export function haversineKm(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.min(1, Math.max(0, Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2));
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function scoreForDistance(km) {
  return km * 1000 < 10 ? 5000 : Math.max(0, Math.round(5000 * Math.exp(-(km * 1000) / 2_000_000)));
}

// ---------- Map maths ----------

// Points along the great circle (shortest path over the globe) from a to b.
export function greatCircle(a, b, steps = 64) {
  const rad = Math.PI / 180;
  const vec = (p) => [Math.cos(p.lat * rad) * Math.cos(p.lng * rad), Math.cos(p.lat * rad) * Math.sin(p.lng * rad), Math.sin(p.lat * rad)];
  const va = vec(a);
  const vb = vec(b);
  const omega = Math.acos(Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s1 = omega < 1e-9 ? 1 - t : Math.sin((1 - t) * omega) / Math.sin(omega);
    const s2 = omega < 1e-9 ? t : Math.sin(t * omega) / Math.sin(omega);
    const v = [0, 1, 2].map((k) => s1 * va[k] + s2 * vb[k]);
    points.push({ lat: Math.atan2(v[2], Math.hypot(v[0], v[1])) / rad, lng: Math.atan2(v[1], v[0]) / rad });
  }
  // Keep longitudes continuous so a path across the date line doesn't jump.
  for (let i = 1; i < points.length; i++) {
    while (points[i].lng - points[i - 1].lng > 180) points[i].lng -= 360;
    while (points[i].lng - points[i - 1].lng < -180) points[i].lng += 360;
  }
  return points;
}

// Web Mercator (as Google Maps): longitude/latitude → 0..1 across and down.
export function mercator(lat, lng) {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

// "42.3601° N, 71.0589° W"
export function formatCoords(lat, lng) {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`;
}
