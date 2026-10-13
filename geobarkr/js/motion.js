// Motion helpers, after Apple's "Designing Fluid Interfaces": springs that
// start from the current value and carry velocity (so motion can be grabbed
// and reversed at any moment), momentum projection for flicks, rubber-banding
// at edges, and a light haptic tick. Everything respects reduced motion.

export const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// A spring on one number. damping 1 = no overshoot; response ≈ seconds to settle.
// set() re-targets from the current value and velocity; jump() moves instantly.
export function spring(initial, onUpdate, config = {}) {
  let value = initial;
  let velocity = 0; // units per second
  let target = initial;
  let frame = null;
  let last = 0;
  let onRest = null;
  let stiffness = 0;
  let friction = 0;
  const tune = ({ damping = 1, response = 0.35 } = {}) => {
    stiffness = (2 * Math.PI / response) ** 2;
    friction = 4 * Math.PI * damping / response;
  };
  tune(config);

  function step(now) {
    const dt = Math.min(0.064, (now - last) / 1000 || 1 / 60);
    last = now;
    // Semi-implicit Euler in small slices for stability.
    for (let t = 0; t < dt; t += 1 / 240) {
      const h = Math.min(1 / 240, dt - t);
      velocity += (-stiffness * (value - target) - friction * velocity) * h;
      value += velocity * h;
    }
    if (Math.abs(value - target) < 0.1 && Math.abs(velocity) < 1) {
      value = target;
      velocity = 0;
      frame = null;
      onUpdate(value);
      const done = onRest;
      onRest = null;
      done?.();
      return;
    }
    onUpdate(value);
    frame = requestAnimationFrame(step);
  }

  return {
    get value() { return value; },
    get target() { return target; },
    // options: velocity (units/s), then (called at rest), damping, response
    set(next, { velocity: v, then, damping, response } = {}) {
      tune({ damping: damping ?? config.damping, response: response ?? config.response });
      target = next;
      if (v != null) velocity = v;
      onRest = then || null;
      if (reducedMotion()) return this.jump(next, then);
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
      return this;
    },
    jump(next, then) {
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      value = target = next;
      velocity = 0;
      onUpdate(value);
      then?.();
      return this;
    },
    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      velocity = 0;
      return this;
    },
  };
}

// Where a flick would come to rest (Apple's deceleration projection).
export function project(velocity, decelerationRate = 0.998) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

// Past an edge, follow less the further you go.
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

// Velocity from the last ~100 ms of pointer samples, in px per second.
export function velocityTracker() {
  let samples = [];
  return {
    add(y, t = performance.now()) {
      samples.push({ y, t });
      samples = samples.filter((s) => t - s.t < 100);
    },
    velocity() {
      if (samples.length < 2) return 0;
      const a = samples[0];
      const b = samples[samples.length - 1];
      return b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0;
    },
    reset() { samples = []; },
  };
}

// Restart a CSS animation that's driven by a class.
export function replay(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

// A short tick on phones that support it, on the same frame as what caused it.
export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

// Count a number up for the reveal; instant with reduced motion.
export function countUp(element, to, format, duration = 650) {
  if (reducedMotion() || !Number.isFinite(to)) {
    element.textContent = format(to);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - p) ** 3;
    element.textContent = format(to * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
