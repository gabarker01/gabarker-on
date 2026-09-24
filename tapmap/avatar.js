// Player avatars: an uploaded photo, or initials on a colour picked from the
// player's id. Used for the profile button, lists, profiles and globe pins.

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

// A player's photo if they've uploaded one, otherwise their initials.
export function avatarElement(person, size = "md") {
  const el = document.createElement("span");
  el.className = `avatar avatar-${size}`;
  el.style.setProperty("--avatar", colourFor(person));
  el.textContent = initials(person);
  el.setAttribute("aria-hidden", "true");
  if (person && person.avatar_url) {
    const img = document.createElement("img");
    img.src = person.avatar_url;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("load", () => el.classList.add("has-photo"));
    img.addEventListener("error", () => img.remove());
    el.append(img);
  }
  return el;
}

// Turns an image file into a square, centre-cropped photo (WebP where the
// browser can encode it, JPEG otherwise), small enough to upload.
export async function squarePhoto(file, size = 320) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("That file isn't an image we can read."));
      image.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    const encode = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, 0.86));
    let blob = await encode("image/webp");
    if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
