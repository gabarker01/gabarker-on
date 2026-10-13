// Page set-up (sign-in check + header) and small DOM helpers.
import { isDemo, getSession, getProfile, signOut } from "./api.js?v=13";
import { loadScript } from "./load.js?v=13";
import { avatar, ME_COLOUR } from "./players.js?v=13";

// h("p", { class: "x", onclick }, "text", child…) → element. Strings become text, never HTML.
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

export const $ = (selector, root = document) => root.querySelector(selector);

// Safari ignores user-scalable=no, so stop its pinch-zoom on the page itself;
// maps and Street View keep their own pinch.
document.addEventListener("gesturestart", (event) => {
  if (!event.target.closest?.(".gb-pano, .gb-map, .gb-results-map, .gm-style, .leaflet-container, .gb-photo")) event.preventDefault();
}, { passive: false });

// After a list re-renders, rows (data-key) that weren't there last time get
// .is-new, so you see who just joined or guessed. Nothing animates on first
// draw, and a row still arriving carries on from where it was if the list is
// drawn again.
const NEW_FOR_MS = 1600;
export function markNew(container) {
  const rows = [...container.children].filter((el) => el.dataset.key);
  const now = performance.now();
  const arrived = container.gbArrived || new Map();
  if (container.gbSeen) {
    for (const row of rows) if (!container.gbSeen.has(row.dataset.key)) arrived.set(row.dataset.key, now);
  }
  for (const row of rows) {
    const since = now - (arrived.get(row.dataset.key) ?? -Infinity);
    if (since < NEW_FOR_MS) {
      row.classList.add("is-new");
      row.style.animationDelay = `${-since}ms, ${-since}ms`;
    } else arrived.delete(row.dataset.key);
  }
  container.gbArrived = arrived;
  container.gbSeen = new Set(rows.map((row) => row.dataset.key));
}
export const param = (name) => new URLSearchParams(location.search).get(name);

// The GeoBarkr mark: a globe with your pin on it.
export function logoMark(size = 22) {
  const wrap = document.createElement("span");
  wrap.className = "gb-mark";
  wrap.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="11" fill="none" stroke="currentColor" stroke-width="1.8"/><ellipse cx="13" cy="13" rx="4.6" ry="11" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".6"/><path d="M2 13h22" stroke="currentColor" stroke-width="1.3" opacity=".6"/><circle cx="17.5" cy="8.5" r="3.2" fill="${ME_COLOUR}" stroke="#F3F5F7" stroke-width="1.6"/></svg>`;
  return wrap;
}

// A short message at the bottom of the screen.
export function toast(message, { error = false } = {}) {
  let box = $(".gb-toast");
  if (!box) {
    box = h("div", { class: "gb-toast", role: "status", "aria-live": "polite" });
    document.body.append(box);
  }
  box.textContent = message;
  box.classList.toggle("is-error", error);
  box.classList.add("is-shown");
  clearTimeout(box._timer);
  box._timer = setTimeout(() => box.classList.remove("is-shown"), error ? 6000 : 3500);
}

export const showError = (error) => toast(error?.message || String(error), { error: true });

// Disable a button while an action runs; errors become a toast.
export async function busy(button, action) {
  if (button) button.disabled = true;
  try {
    return await action();
  } catch (error) {
    showError(error);
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}

export function signInUrl(next = location.pathname + location.search) {
  return `/geobarkr/signin/?next=${encodeURIComponent(next)}`;
}

// "How to play": a ? button that opens a short guide. Used in the header and
// on the game screens' top bar.
// Sheets (<dialog>) slide up when opened and back down when closed, whether
// closed by the X, a tap outside or Escape. Returns the animated close().
export function sheetDialog(dialog) {
  const close = () => {
    if (!dialog.open || dialog.classList.contains("is-closing")) return;
    const done = () => { dialog.classList.remove("is-closing"); dialog.close(); };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return done();
    dialog.classList.add("is-closing");
    dialog.addEventListener("animationend", done, { once: true });
    setTimeout(() => { if (dialog.classList.contains("is-closing")) done(); }, 400);
  };
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  return close;
}

let helpDialog = null;
let closeHelp = null;
const X_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
export function closeButton(onClose) {
  const button = h("button", { type: "button", class: "gb-help-close", "aria-label": "Close", onclick: onClose });
  button.innerHTML = X_ICON;
  return button;
}
function openHelp() {
  if (!helpDialog) {
    const row = (km, pts) => h("tr", {}, h("td", {}, km), h("td", { class: "r" }, pts));
    helpDialog = h("dialog", { class: "gb-help", "aria-labelledby": "gb-help-title" },
      h("div", { class: "gb-help-head" },
        h("h2", { id: "gb-help-title" }, "How to play"),
        closeButton(() => closeHelp())),
      h("ol", { class: "gb-help-steps" },
        h("li", {}, h("b", {}, "Look around. "), "You're dropped somewhere in Street View. Drag to turn, pinch to zoom, and tap the road to move. Look for signs, languages, which side people drive on, plants and the landscape. On photo maps you get a photo instead: pinch, double-tap or scroll to zoom in."),
        h("li", {}, h("b", {}, "Guess. "), "Tap the map bubble in the corner to open the map, then tap where you think you are. Tap again to move your pin. Press Guess when you're happy."),
        h("li", {}, h("b", {}, "Score. "), "The closer you are, the more points: up to 5,000 a round, with full marks within 10 metres. Five rounds make a game."),
        h("li", {}, h("b", {}, "Time. "), "How long you take is shown in the results so you can compare, but only distance counts towards points.")),
      h("table", { class: "gb-help-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "If you're off by"), h("th", { class: "r" }, "you score"))),
        h("tbody", {}, row("10 metres", "5,000"), row("100 km", "4,756"), row("500 km", "3,894"), row("1,000 km", "3,033"), row("3,000 km", "1,116"))),
      h("h3", {}, "Three ways to play"),
      h("ul", { class: "gb-help-modes" },
        h("li", {}, h("b", {}, "Solo: "), "five rounds on your own."),
        h("li", {}, h("b", {}, "With friends: "), "everyone plays on their own phone; share the room code or link. Scores are revealed together when a round ends."),
        h("li", {}, h("b", {}, "Party: "), "Street View on a TV or laptop for the room, guesses on phones. The host can end a round when everyone's ready.")),
      h("h3", {}, "Make your own map"),
      h("p", { class: "gb-help-make" }, "Tap your picture, then Create map: five places in Street View or your own photos, for anyone or just you."),
      h("p", { class: "gb-help-foot" }, h("a", { href: "/geobarkr/about/" }, "More about GeoBarkr")));
    closeHelp = sheetDialog(helpDialog);
    document.body.append(helpDialog);
  }
  helpDialog.showModal();
}

export function helpButton() {
  return h("button", { type: "button", class: "gb-help-btn", "aria-label": "How to play", onclick: openHelp }, "?");
}

// The header: GeoBarkr, the pages (inline on wide screens), How to play and
// your picture, which opens your profile (stats, your maps, sign out).
function header(profile) {
  const links = [["/geobarkr/", "Play"], ["/geobarkr/games/", "My games"], ["/geobarkr/leaderboard/", "Leaderboard"]];
  if (profile?.role === "admin") links.push(["/geobarkr/admin/", "Admin"]);
  const nav = h("nav", { class: "gb-menu", "aria-label": "GeoBarkr" },
    links.map(([href, label]) => h("a", { href, "aria-current": location.pathname === href ? "page" : false }, label)));
  const me = { name: profile?.display_name || "Me", avatar_url: profile?.avatar_url };
  const onProfile = location.pathname === "/geobarkr/profile/";
  const bar = h("header", { class: "gb-header" },
    h("a", { class: "gb-brand", href: "/geobarkr/" }, logoMark(), "GeoBarkr"),
    h("div", { class: "gb-header-right" }, nav, helpButton(),
      h("a", { class: "gb-me", href: "/geobarkr/profile/", "aria-label": `Your profile, ${me.name}`, "aria-current": onProfile ? "page" : false },
        avatar(me, ME_COLOUR, 32))),
  );
  // The bar floats over the page; it gains its frosted backing once content scrolls under it.
  const onScroll = () => bar.classList.toggle("is-scrolled", window.scrollY > 4);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  return bar;
}

export async function signOutAndLeave() {
  await signOut();
  location.href = "/geobarkr/signin/";
}

// Every page: signed in? then the header (and a note in demo mode).
// Resolves to { session, profile } (never resolves if sent to sign in).
// Pages fade in once they're ready (see "Loading" in the CSS). A page that
// needs its data first passes { hold: true } and calls pageReady() itself.
export function pageReady() {
  document.body.classList.add("is-ready");
}

export async function initPage({ demoNote = true, hold = false } = {}) {
  const session = await getSession();
  if (!session) {
    location.replace(signInUrl());
    return new Promise(() => {});
  }
  const profile = await getProfile().catch(() => null);
  const slot = $("#gb-header");
  if (slot) slot.replaceWith(header(profile));
  if (isDemo && demoNote) {
    document.body.append(h("p", { class: "gb-demo-note" },
      "Demo mode: games are saved on this device only, and bots play the other players."));
  }
  if (!hold) pageReady();
  return { session, profile };
}

// A game page that can't show its game: say why and offer a way back.
export function pageError(error) {
  const main = document.querySelector("main");
  main.className = "gb-page gb-notice";
  main.replaceChildren(
    h("h1", { class: "gb-title" }, "Can't open this game"),
    h("p", { class: "gb-lede" }, `${error?.message || error}. Check the link, or join with the room code.`),
    h("p", {}, h("a", { class: "gb-btn", href: "/geobarkr/" }, "Back to GeoBarkr")),
  );
}

// Room-code fields: capitals and digits only.
export function codeInput(input) {
  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  return input;
}

// The QR code for a join link, as an SVG element.
export async function qrCode(text) {
  await loadScript("/geobarkr/vendor/qrcode-generator-1.4.4.js");
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const wrapper = document.createElement("div");
  wrapper.className = "gb-qr";
  wrapper.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  wrapper.firstElementChild?.setAttribute("aria-label", `QR code for ${text}`);
  return wrapper;
}

export const joinUrl = (code) => `${location.origin}/geobarkr/join/?code=${encodeURIComponent(code)}`;

// What a map shows: Street View or photos, as a small icon and a word.
const KIND_ICONS = {
  street_view: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.4"/><path d="M8.5 11.5c0-1.4 1.1-2.5 2.5-2.5h2c1.4 0 2.5 1.1 2.5 2.5V15h-2l-.6 6h-1.8l-.6-6h-2z"/><path d="M5 17.5c-1.3.5-2 1.1-2 1.7C3 20.8 7 22 12 22s9-1.2 9-2.8c0-.6-.7-1.2-2-1.7"/></svg>',
  photo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8.5 8.5"/></svg>',
};
export const KIND_NAMES = { street_view: "Street View", photo: "Photos" };
export function kindIcon(kind) {
  const span = h("span", { class: `gb-kind is-${kind === "photo" ? "photo" : "sv"}`, title: KIND_NAMES[kind] || KIND_NAMES.street_view });
  span.innerHTML = KIND_ICONS[kind] || KIND_ICONS.street_view;
  return span;
}
export function kindTag(kind) {
  const tag = kindIcon(kind);
  tag.classList.add("with-label");
  tag.append(KIND_NAMES[kind] || KIND_NAMES.street_view);
  return tag;
}

// A chevron for rows that open something.
export function chevron() {
  const span = h("span", { class: "gb-chev", "aria-hidden": "true" });
  span.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  return span;
}
