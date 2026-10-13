// Test helper: put GPS tags into a JPEG, as a phone camera does.
// withGps(jpegBytes, lat, lng, { littleEndian }) → Uint8Array.
export function withGps(jpeg, lat, lng, { littleEndian = true } = {}) {
  const tiff = new DataView(new ArrayBuffer(200));
  const le = littleEndian;
  tiff.setUint16(0, le ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, le);
  tiff.setUint32(4, 8, le); // IFD0 at 8
  // IFD0: one entry, the GPS IFD pointer.
  tiff.setUint16(8, 1, le);
  entry(tiff, 10, 0x8825, 4, 1, 26, le);
  tiff.setUint32(22, 0, le);
  // GPS IFD at 26: four entries.
  tiff.setUint16(26, 4, le);
  const ascii = (at, letter) => tiff.setUint8(at, letter.charCodeAt(0));
  entry(tiff, 28, 1, 2, 2, 0, le); ascii(36, lat < 0 ? "S" : "N");
  entry(tiff, 40, 2, 5, 3, 80, le);
  entry(tiff, 52, 3, 2, 2, 0, le); ascii(60, lng < 0 ? "W" : "E");
  entry(tiff, 64, 4, 5, 3, 104, le);
  tiff.setUint32(76, 0, le);
  rationals(tiff, 80, Math.abs(lat), le);
  rationals(tiff, 104, Math.abs(lng), le);
  const body = new Uint8Array(tiff.buffer, 0, 128);
  const header = [0x45, 0x78, 0x69, 0x66, 0, 0];
  const length = 2 + header.length + body.length;
  const app1 = new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...header, ...body]);
  const bytes = new Uint8Array(jpeg);
  return new Uint8Array([...bytes.slice(0, 2), ...app1, ...bytes.slice(2)]);
}

function entry(view, at, tag, type, count, value, le) {
  view.setUint16(at, tag, le);
  view.setUint16(at + 2, type, le);
  view.setUint32(at + 4, count, le);
  view.setUint32(at + 8, value, le);
}

function rationals(view, at, value, le) {
  const degrees = Math.floor(value);
  const minutes = Math.floor((value - degrees) * 60);
  const seconds = Math.round(((value - degrees) * 60 - minutes) * 60 * 10000);
  [[degrees, 1], [minutes, 1], [seconds, 10000]].forEach(([n, d], i) => {
    view.setUint32(at + i * 8, n, le);
    view.setUint32(at + i * 8 + 4, d, le);
  });
}
