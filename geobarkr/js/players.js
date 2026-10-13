// Player colours, initials and avatars. You are always ember; everyone else
// gets a colour in the order they joined, so it's the same on every screen.
export const ME_COLOUR = "#F26A3D";
const PALETTE = ["#5B6CFF", "#12A57A", "#D49A1E", "#D6457F", "#2A93D5", "#8A5CE6", "#6E9A1C", "#B0632A", "#0F8F8F", "#9C4DB8"];

export function colourMap(players, meId) {
  const sorted = [...players].sort((a, b) => String(a.joined_at || "").localeCompare(String(b.joined_at || "")));
  const map = new Map();
  let next = 0;
  for (const player of sorted) {
    map.set(player.user_id, player.user_id === meId ? ME_COLOUR : PALETTE[next++ % PALETTE.length]);
  }
  return map;
}

export function initials(name) {
  // "Pip (bot)" → "PI"; "George Barker" → "GB".
  const parts = String(name || "?").replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || "?").slice(0, 2);
  return letters.toUpperCase();
}

// A round avatar: the Google photo if there is one, else initials on the player's colour.
export function avatar(player, colour, size = 28) {
  const node = document.createElement("span");
  node.className = "gb-av";
  node.style.cssText = `--c:${colour};--s:${size}px`;
  node.title = player.name || "";
  if (player.avatar_url) {
    const img = document.createElement("img");
    Object.assign(img, { src: player.avatar_url, alt: "", referrerPolicy: "no-referrer", loading: "lazy" });
    img.addEventListener("error", () => img.replaceWith(initials(player.name)));
    node.append(img);
  } else {
    node.append(initials(player.name));
  }
  return node;
}
