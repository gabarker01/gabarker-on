// Player colours, initials and avatars. You are always ember; everyone else
// gets a colour in the order they joined, so it's the same on every screen.
export const ME_COLOUR = "#FF8A5B";
const PALETTE = ["#B9A6FF", "#6EE7B7", "#F2CF5B", "#5DB0FF", "#F28B82", "#7FD8BE", "#E5A1FF", "#A3E635", "#FDBA74", "#93C5FD"];

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
