// Satellite photo for satellite practice rounds. The Esri tiles around the
// place are drawn onto a canvas and shown from a blob: URL, so the image's
// address (and its alt text) says nothing about where it is.

const TILE = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const TILE_SIZE = 256;

// Web Mercator pixel position of a point at a zoom level.
function worldPixel({ lat, lng }, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const clamped = Math.max(-85, Math.min(85, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

async function loadTile(url, signal) {
  const response = await fetch(url, { mode: "cors", signal });
  if (!response.ok) throw new Error(`Tile request failed (${response.status})`);
  return createImageBitmap(await response.blob());
}

// Draws the photo at one zoom level. Tiles that fail are left dark; it only
// gives up if fewer than half of them load.
async function drawAt(place, zoom, size, signal) {
  const centre = worldPixel(place, zoom);
  const left = centre.x - size / 2;
  const top = centre.y - size / 2;
  const tiles = 2 ** zoom;
  const jobs = [];
  for (let ty = Math.floor(top / TILE_SIZE); ty <= Math.floor((top + size - 1) / TILE_SIZE); ty++) {
    if (ty < 0 || ty >= tiles) continue;
    for (let tx = Math.floor(left / TILE_SIZE); tx <= Math.floor((left + size - 1) / TILE_SIZE); tx++) {
      const wrapped = ((tx % tiles) + tiles) % tiles;
      jobs.push(loadTile(TILE(zoom, wrapped, ty), signal).then((image) => ({ image, tx, ty })));
    }
  }
  const results = await Promise.allSettled(jobs);
  const loaded = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (loaded.length * 2 < jobs.length) {
    const failure = results.find((r) => r.status === "rejected");
    throw (failure && failure.reason) || new Error("Satellite tiles didn't load");
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, size, size);
  for (const { image, tx, ty } of loaded) {
    ctx.drawImage(image, Math.round(tx * TILE_SIZE - left), Math.round(ty * TILE_SIZE - top));
    if (image.close) image.close();
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the photo"))), "image/jpeg", 0.88));
}

// Resolves to { url, revoke } for a size × size photo centred on the place.
// Tries a closer view first, then a wider one if the close tiles don't load.
export async function satellitePhoto(place, { zooms = [12, 10], size = 512, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let lastError = null;
  try {
    for (const zoom of zooms) {
      try {
        const blob = await drawAt(place, zoom, size, controller.signal);
        const url = URL.createObjectURL(blob);
        return { url, revoke: () => URL.revokeObjectURL(url) };
      } catch (error) {
        lastError = error;
        if (controller.signal.aborted) break;
        console.warn(`Satellite photo at zoom ${zoom} failed:`, error);
      }
    }
    throw lastError || new Error("Satellite photo unavailable");
  } finally {
    clearTimeout(timer);
  }
}
