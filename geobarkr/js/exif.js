// Where a photo was taken, from the GPS tags a phone camera writes into a
// JPEG (EXIF). Just enough of the format for that; no library needed.
// readExifGps(ArrayBuffer) → { lat, lng } or null.

export function readExifGps(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not a JPEG
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) return null;
      const marker = view.getUint8(offset + 1);
      if (marker === 0xff) { offset += 1; continue; } // padding
      if (marker === 0xda || marker === 0xd9) return null; // image data: no EXIF before it
      const length = view.getUint16(offset + 2);
      if (marker === 0xe1 && isExifHeader(view, offset + 4)) return readTiff(view, offset + 10, length - 8);
      offset += 2 + length;
    }
  } catch {
    // A truncated or unusual file: treat it as having no location.
  }
  return null;
}

function isExifHeader(view, at) {
  // "Exif\0\0"
  return view.getUint32(at) === 0x45786966 && view.getUint16(at + 4) === 0;
}

function readTiff(view, start, length) {
  const end = Math.min(view.byteLength, start + length);
  const order = view.getUint16(start);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  const u16 = (at) => view.getUint16(start + at, little);
  const u32 = (at) => view.getUint32(start + at, little);
  if (u16(2) !== 42) return null;

  const entries = (ifd) => {
    if (start + ifd + 2 > end) return [];
    const count = u16(ifd);
    return Array.from({ length: count }, (_, i) => {
      const at = ifd + 2 + i * 12;
      return { tag: u16(at), type: u16(at + 2), count: u32(at + 4), at: at + 8 };
    }).filter((entry) => start + entry.at + 4 <= end);
  };

  const gpsPointer = entries(u32(4)).find((entry) => entry.tag === 0x8825);
  if (!gpsPointer) return null;
  const gps = new Map(entries(u32(gpsPointer.at)).map((entry) => [entry.tag, entry]));

  // Degrees, minutes, seconds: three RATIONALs (type 5) stored elsewhere.
  const dms = (entry) => {
    if (!entry || entry.type !== 5 || entry.count < 3) return null;
    const base = u32(entry.at);
    if (start + base + 24 > end) return null;
    const part = (i) => {
      const denominator = u32(base + i * 8 + 4);
      return denominator ? u32(base + i * 8) / denominator : 0;
    };
    return part(0) + part(1) / 60 + part(2) / 3600;
  };
  // N/S or E/W: one ASCII letter, stored in the entry itself.
  const ref = (entry) => (entry ? String.fromCharCode(view.getUint8(start + entry.at)) : "");

  const lat = dms(gps.get(2));
  const lng = dms(gps.get(4));
  if (lat == null || lng == null) return null;
  const result = {
    lat: ref(gps.get(1)) === "S" ? -lat : lat,
    lng: ref(gps.get(3)) === "W" ? -lng : lng,
  };
  // Cameras without a fix sometimes write 0, 0.
  if (!(Math.abs(result.lat) <= 90 && Math.abs(result.lng) <= 180) || (result.lat === 0 && result.lng === 0)) return null;
  return result;
}
