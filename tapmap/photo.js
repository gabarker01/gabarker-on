// Landmark photos for photo rounds: the main photo of the place's Wikipedia
// article. The image is downloaded and shown from a blob: URL, so the image's
// address (and its alt text) says nothing about where it is. The photo's
// author and licence (Wikimedia Commons) are looked up for the credit shown
// once the round is answered.

const WIKI = "https://en.wikipedia.org";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const WIDTH = 800;

// The article to take the photo from: the place's `photo`, or the first part
// of its name ("Eiffel Tower, Paris, France" -> "Eiffel Tower").
export const photoTitle = (place) => (place.photo && place.photo.trim()) || place.name.split(",")[0].trim();

async function getJson(url, signal) {
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

async function getBlob(url, signal) {
  const response = await fetch(url, { mode: "cors", signal });
  if (!response.ok) throw new Error(`Photo request failed (${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("Not an image");
  return blob;
}

// The file name from an upload.wikimedia.org address, for the credit.
function fileName(source) {
  const parts = source.split("/");
  const thumb = parts.indexOf("thumb");
  const name = thumb >= 0 ? parts[thumb + 3] : parts[parts.length - 1];
  try { return decodeURIComponent(name); } catch (e) { return name; }
}

// Resolves to { url, revoke, file, page } or rejects if the article has no
// usable photo (flags, maps and other drawings are skipped).
export async function landmarkPhoto(place, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const title = photoTitle(place).replace(/ /g, "_");
    const summary = await getJson(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title)}`, controller.signal);
    const original = summary.originalimage;
    if (summary.type === "disambiguation" || !original || !original.source) throw new Error(`No photo for ${title}`);
    if (/\.(svg|gif)$/i.test(original.source) || /\.svg\.png$/i.test((summary.thumbnail || {}).source || "")) {
      throw new Error(`${title}'s picture isn't a photo`);
    }
    // A thumbnail about 800 px wide (the original can be many megabytes).
    const thumb = summary.thumbnail && summary.thumbnail.source;
    const sized = thumb && original.width > WIDTH ? thumb.replace(/\/\d+px-/, `/${WIDTH}px-`) : original.source;
    let blob;
    try {
      blob = await getBlob(sized, controller.signal);
    } catch (error) {
      if (!thumb || sized === thumb) throw error;
      blob = await getBlob(thumb, controller.signal);
    }
    const url = URL.createObjectURL(blob);
    return {
      url,
      revoke: () => URL.revokeObjectURL(url),
      file: fileName(original.source),
      page: (summary.content_urls && summary.content_urls.desktop && summary.content_urls.desktop.page) || `${WIKI}/wiki/${title}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

const plain = (html) => {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent.replace(/\s+/g, " ").trim();
};

// The photo's author and licence from Wikimedia Commons, for the credit.
// Resolves to { artist, license, url }; the fields may be empty.
export async function photoCredit(file) {
  const params = new URLSearchParams({
    action: "query", format: "json", origin: "*", prop: "imageinfo", iiprop: "extmetadata|url", titles: `File:${file}`,
  });
  const data = await getJson(`${COMMONS_API}?${params}`);
  const page = Object.values((data.query && data.query.pages) || {})[0] || {};
  const info = (page.imageinfo || [])[0] || {};
  const meta = info.extmetadata || {};
  return {
    artist: plain(meta.Artist && meta.Artist.value).slice(0, 80),
    license: plain(meta.LicenseShortName && meta.LicenseShortName.value),
    url: info.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
  };
}
