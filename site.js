// gabarker.com: the light/dark toggle, and the grid lines that brighten
// around the pointer (drifting slowly on their own when there isn't one).
const root = document.documentElement;
const toggle = document.getElementById("theme-toggle");

// Dark unless the visitor chose light.
const activeTheme = () => root.dataset.theme || "dark";
function syncToggle() {
  const theme = activeTheme();
  root.dataset.activeTheme = theme;
  toggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
}
toggle.addEventListener("click", () => {
  const next = activeTheme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch (e) {}
  syncToggle();
});
syncToggle();

const glow = document.querySelector(".grid-glow");
const still = window.matchMedia("(prefers-reduced-motion: reduce)");
let x = window.innerWidth * 0.5;
let y = window.innerHeight * 0.3;
let target = null; // the pointer, when there's one
let lastMove = 0;
window.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  target = { x: e.clientX, y: e.clientY };
  lastMove = performance.now();
});
document.addEventListener("pointerleave", () => { target = null; });

function frame(now) {
  let tx;
  let ty;
  if (target && now - lastMove < 4000) {
    ({ x: tx, y: ty } = target);
  } else {
    // A slow figure-of-eight across the top of the page.
    const t = now / 1000;
    tx = window.innerWidth * (0.5 + 0.32 * Math.sin(t * 0.13));
    ty = window.innerHeight * (0.32 + 0.16 * Math.sin(t * 0.26));
  }
  x += (tx - x) * 0.08;
  y += (ty - y) * 0.08;
  glow.style.setProperty("--x", `${x.toFixed(1)}px`);
  glow.style.setProperty("--y", `${y.toFixed(1)}px`);
  if (!still.matches) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
