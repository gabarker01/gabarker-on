// The guess sheet on phones: drag its top edge and it follows your finger;
// let go and it springs to the size you were heading for (a flick throws it),
// carrying your finger's speed. It can be caught mid-flight. Past the
// smallest or largest size it resists instead of stopping dead.
// On wider screens the sheet is a floating panel and CSS sizes it.
import { spring, project, rubberband, velocityTracker, haptic } from "./motion.js";

const PHONE = "(max-width: 899px)";

export function draggableSheet(sheet, handle, { onChange } = {}) {
  const phone = window.matchMedia(PHONE);
  const box = sheet.parentElement;
  const sizes = () => {
    const room = box.clientHeight;
    return { peek: Math.max(300, Math.round(room * 0.46)), full: Math.round(room - 62) };
  };
  let expanded = false;
  const motion = spring(0, (h) => { sheet.style.height = `${h}px`; }, { damping: 1, response: 0.35 });

  const settle = (next, velocity = 0) => {
    const changed = next !== expanded;
    expanded = next;
    sheet.classList.toggle("is-expanded", next);
    const { peek, full } = sizes();
    // Apple's drawer spring; a little bounce only when a flick carried momentum.
    motion.set(next ? full : peek, { velocity, damping: Math.abs(velocity) > 400 ? 0.8 : 1, response: 0.3 });
    if (changed) onChange?.(next);
  };

  function layout({ instant = false } = {}) {
    if (!phone.matches) {
      motion.stop();
      sheet.style.height = "";
      return;
    }
    if (drag) return; // never move it out from under a finger
    const { peek, full } = sizes();
    if (instant) motion.jump(expanded ? full : peek);
    else motion.set(expanded ? full : peek);
  }
  phone.addEventListener("change", () => layout({ instant: true }));
  window.addEventListener("resize", () => layout());

  // ---- Dragging ----
  let drag = null;
  const tracker = velocityTracker();
  layout({ instant: true });
  handle.addEventListener("pointerdown", (event) => {
    if (!phone.matches || event.button > 0) return;
    handle.setPointerCapture(event.pointerId);
    motion.stop(); // catch it where it is
    drag = { id: event.pointerId, y: event.clientY, start: sheet.getBoundingClientRect().height, moved: false, ...sizes() };
    tracker.reset();
    tracker.add(event.clientY);
    sheet.classList.add("is-dragging");
  });
  handle.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dy = event.clientY - drag.y;
    if (Math.abs(dy) > 4) drag.moved = true;
    tracker.add(event.clientY);
    const { peek, full } = drag;
    let h = drag.start - dy;
    if (h > full) h = full + rubberband(h - full, full);
    if (h < peek) h = peek - rubberband(peek - h, peek);
    motion.jump(h);
  });
  const end = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const { moved, peek, full } = drag;
    tracker.add(event.clientY); // a pause before letting go means no flick
    drag = null;
    sheet.classList.remove("is-dragging");
    if (!moved) {
      settle(!expanded); // a tap on the handle toggles
      return;
    }
    const velocity = -tracker.velocity(); // growing = positive
    const projected = motion.value + project(velocity);
    const next = Math.abs(projected - full) < Math.abs(projected - peek);
    if (next !== expanded) haptic(6);
    settle(next, velocity);
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);

  return {
    get expanded() { return expanded; },
    set(next) {
      if (phone.matches) settle(next);
      else {
        expanded = next;
        sheet.classList.toggle("is-expanded", next);
        onChange?.(next);
      }
    },
  };
}
