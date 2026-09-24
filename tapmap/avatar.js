// Player avatars: initials on a colour picked from the player's id, used for
// the account button, lists and friends' pins on the globe.

const COLOURS = ["#d9b26a", "#6fb592", "#7ea6e0", "#e3925d", "#c492d8", "#e07c8e", "#5ec0bf", "#b7c46a"];

export function initials(person) {
  if (!person) return "?";
  const name = (person.display_name || "").trim();
  const words = name.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  const single = (words[0] || person.username || "?").replace(/[^\p{L}\p{N}]/gu, "");
  return (single.slice(0, 2) || "?").toUpperCase();
}

export function colourFor(person) {
  const key = (person && (person.id || person.username)) || "";
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return COLOURS[Math.abs(h) % COLOURS.length];
}

export function avatarElement(person, size = "md") {
  const el = document.createElement("span");
  el.className = `avatar avatar-${size}`;
  el.style.setProperty("--avatar", colourFor(person));
  el.textContent = initials(person);
  el.setAttribute("aria-hidden", "true");
  return el;
}
