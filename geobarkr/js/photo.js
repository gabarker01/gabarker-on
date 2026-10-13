// Photo maps: getting a photo ready to upload, and showing a round's photo.
//
// preparePhoto(file) reads where the photo was taken (EXIF GPS) and redraws
// it smaller as a JPEG. Redrawing drops every EXIF tag, so the uploaded file
// never gives the answer away.
//
// createPhotoView(element) shows a photo whole, centred, on a frosted, blurred
// copy of itself (like iOS), and lets you pinch, drag, double-tap or scroll to
// zoom. It has the same show / home / hide as the Street View panorama.
import { readExifGps } from "./exif.js?v=13";
import { spring, project, rubberband, velocityTracker, reducedMotion } from "./motion.js?v=13";

export async function preparePhoto(file, { maxSide = 2048, quality = 0.85 } = {}) {
  if (!file || !/^image\//.test(file.type || "image/")) throw new Error("Choose a photo");
  const gps = readExifGps(await file.arrayBuffer());
  const image = await decode(file);
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);
  image.close?.();
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (result) => (result ? resolve(result) : reject(new Error("Couldn't read that photo"))), "image/jpeg", quality));
  return { blob, gps, width, height };
}

// Upright as the camera held it (browsers apply the EXIF orientation).
async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new Error("Couldn't open that photo. Try a JPEG or PNG");
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

const MAX_ZOOM = 5;

export function createPhotoView(element) {
  const root = document.createElement("div");
  root.className = "gb-photo";
  root.hidden = true;
  const glass = document.createElement("div");
  glass.className = "gb-photo-glass";
  const sheet = document.createElement("div");
  sheet.className = "gb-photo-sheet";
  const img = document.createElement("img");
  img.className = "gb-photo-img";
  img.alt = "The photo for this round";
  img.draggable = false;
  img.decoding = "async";
  sheet.append(img);
  root.append(glass, sheet);
  element.append(root);

  let current = null;
  // The photo's size on screen at zoom 1 (whole photo, centred), then the zoom.
  let fit = { w: 0, h: 0 };
  let view = { s: 1, x: 0, y: 0 };

  const box = () => ({ w: root.clientWidth, h: root.clientHeight });
  // Room kept clear at the top for a bar floating over the photo (--photo-top).
  let top = 0;
  function layout() {
    top = parseFloat(getComputedStyle(root).getPropertyValue("--photo-top")) || 0;
    const w = root.clientWidth;
    const h = Math.max(1, root.clientHeight - top);
    const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : w / Math.max(1, h);
    fit = w / h > ratio ? { w: h * ratio, h } : { w, h: w / ratio };
    sheet.style.width = `${fit.w}px`;
    sheet.style.height = `${fit.h}px`;
    apply(clamp(view));
  }
  function apply(next) {
    view = next;
    // Centred below the bar at full size, easing to the whole screen by 2×.
    const shift = (top / 2) * Math.max(0, Math.min(1, 2 - view.s));
    sheet.style.transform = `translate(-50%, -50%) translate(${view.x}px, ${view.y + shift}px) scale(${view.s})`;
    root.classList.toggle("is-zoomed", view.s > 1.01);
  }
  // How far the photo can move at zoom s: only as far as its edges.
  const limits = (s) => {
    const { w, h } = box();
    return { x: Math.max(0, (fit.w * s - w) / 2), y: Math.max(0, (fit.h * s - h) / 2) };
  };
  function clamp({ s, x, y }) {
    const scale = Math.min(MAX_ZOOM, Math.max(1, s));
    const max = limits(scale);
    return { s: scale, x: Math.min(max.x, Math.max(-max.x, x)), y: Math.min(max.y, Math.max(-max.y, y)) };
  }
  // Past the edges or the zoom limits, follow less (rubber band).
  function soft({ s, x, y }) {
    const scale = s > MAX_ZOOM ? MAX_ZOOM + rubberband(s - MAX_ZOOM, MAX_ZOOM, 0.4) : s < 1 ? 1 - rubberband(1 - s, 1, 0.4) : s;
    const max = limits(scale);
    const { w, h } = box();
    const band = (v, m, d) => (v > m ? m + rubberband(v - m, d) : v < -m ? -m - rubberband(-m - v, d) : v);
    return { s: scale, x: band(x, max.x, w), y: band(y, max.y, h) };
  }

  // One spring (0 to 1000, for a smooth finish) carries the view from where
  // it is to where it rests.
  let from = view;
  let to = view;
  const settle = spring(1000, (v) => {
    const p = v / 1000;
    apply({ s: from.s + (to.s - from.s) * p, x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p });
  }, { damping: 1, response: 0.4 });
  function animateTo(target) {
    settle.stop();
    from = view;
    to = clamp(target);
    settle.jump(0);
    settle.set(1000);
  }
  // Zoom to s, keeping the point (px, py) from the centre where it is.
  const zoomAbout = (start, s, px, py) => ({ s, x: px - ((px - start.x) * s) / start.s, y: py - ((py - start.y) * s) / start.s });
  const centreOffset = (event) => {
    const rect = root.getBoundingClientRect();
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
  };

  // ---------- Gestures ----------
  const pointers = new Map();
  let gesture = null;
  let lastTap = null;
  const vx = velocityTracker();
  const vy = velocityTracker();

  function begin() {
    settle.stop();
    const points = [...pointers.values()];
    vx.reset();
    vy.reset();
    if (points.length >= 2) {
      const [a, b] = points;
      gesture = { kind: "pinch", start: view, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    } else if (points.length === 1) {
      // After a pinch, the finger left over pans but never counts as a tap.
      gesture = { kind: "pan", start: view, from: { ...points[0] }, moved: 0, afterPinch: gesture?.kind === "pinch" || gesture?.afterPinch };
    }
  }
  root.addEventListener("pointerdown", (event) => {
    if (event.button > 0) return;
    root.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, centreOffset(event));
    begin();
  });
  root.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, centreOffset(event));
    const points = [...pointers.values()];
    if (gesture.kind === "pinch" && points.length >= 2) {
      const [a, b] = points;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = gesture.start.s * (Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance);
      const zoomed = zoomAbout(gesture.start, s, gesture.mid.x, gesture.mid.y);
      apply(soft({ s, x: zoomed.x + mid.x - gesture.mid.x, y: zoomed.y + mid.y - gesture.mid.y }));
    } else if (gesture.kind === "pan") {
      const p = points[0];
      const dx = p.x - gesture.from.x;
      const dy = p.y - gesture.from.y;
      gesture.moved = Math.max(gesture.moved, Math.hypot(dx, dy));
      vx.add(p.x);
      vy.add(p.y);
      if (gesture.start.s > 1.01) apply(soft({ s: gesture.start.s, x: gesture.start.x + dx, y: gesture.start.y + dy }));
    }
  });
  function end(event) {
    if (!pointers.has(event.pointerId)) return;
    const point = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    const was = gesture;
    if (pointers.size) return begin(); // one finger left after a pinch: carry on panning
    gesture = null;
    if (was?.kind === "pan" && !was.afterPinch && was.moved < 8 && event.type === "pointerup") {
      // A double tap zooms in on that spot, or back out.
      const now = performance.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 30) {
        lastTap = null;
        animateTo(view.s > 1.01 ? { s: 1, x: 0, y: 0 } : zoomAbout(view, 2.5, point.x, point.y));
        return;
      }
      lastTap = { t: now, x: point.x, y: point.y };
    }
    // Let go: a flick carries on, then everything springs back inside the edges.
    const flick = was?.kind === "pan" && view.s > 1.01 && !reducedMotion();
    animateTo({ s: view.s, x: view.x + (flick ? project(vx.velocity()) : 0), y: view.y + (flick ? project(vy.velocity()) : 0) });
  }
  root.addEventListener("pointerup", end);
  root.addEventListener("pointercancel", end);
  root.addEventListener("wheel", (event) => {
    event.preventDefault();
    settle.stop();
    const p = centreOffset(event);
    const s = Math.min(MAX_ZOOM, Math.max(1, view.s * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002))));
    apply(clamp(zoomAbout(view, s, p.x, p.y)));
  }, { passive: false });
  // Safari's own pinch events would zoom the page; the photo handles pinch itself.
  for (const name of ["gesturestart", "gesturechange"]) root.addEventListener(name, (event) => event.preventDefault());

  img.addEventListener("load", () => {
    layout();
    root.classList.add("is-loaded");
  });
  new ResizeObserver(() => { if (!root.hidden) layout(); }).observe(root);

  return {
    element: root,
    show(target) {
      if (current === target.photo_url) return;
      current = target.photo_url;
      root.classList.remove("is-loaded");
      view = { s: 1, x: 0, y: 0 };
      root.hidden = false;
      glass.style.backgroundImage = `url("${String(target.photo_url).replace(/"/g, "%22")}")`;
      img.src = target.photo_url;
      if (img.complete && img.naturalWidth) {
        layout();
        root.classList.add("is-loaded");
      }
    },
    home() { animateTo({ s: 1, x: 0, y: 0 }); },
    hide() {
      current = null;
      root.hidden = true;
      img.removeAttribute("src");
    },
    onHeading() { return false; },
  };
}
