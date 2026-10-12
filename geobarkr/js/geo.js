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
