// Page set-up (sign-in check + header) and small DOM helpers.
import { isDemo, getSession, getProfile, signOut } from "./api.js";
import { loadScript } from "./load.js";
import { avatar, ME_COLOUR } from "./players.js";

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
  wrap.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="11" fill="none" stroke="currentColor" stroke-width="1.8"/><ellipse cx="13" cy="13" rx="4.6" ry="11" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".6"/><path d="M2 13h22" stroke="currentColor" stroke-width="1.3" opacity=".6"/><circle cx="17.5" cy="8.5" r="3.2" fill="${ME_COLOUR}" stroke="#0B1426" stroke-width="1.6"/></svg>`;
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

function header(profile) {
  const links = [["/geobarkr/", "Play"], ["/geobarkr/games/", "My games"], ["/geobarkr/leaderboard/", "Leaderboard"]];
  if (profile?.role === "admin") links.push(["/geobarkr/admin/", "Admin"]);
  const menu = h("nav", { class: "gb-menu", id: "gb-menu", "aria-label": "GeoBarkr" },
    links.map(([href, label]) => h("a", { href, "aria-current": location.pathname === href ? "page" : false }, label)),
    h("button", { type: "button", class: "gb-menu-signout", onclick: async () => { await signOut(); location.href = "/geobarkr/signin/"; } }, "Sign out"),
  );
  const me = { name: profile?.display_name || "Me", avatar_url: profile?.avatar_url };
  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    menu.classList.toggle("is-open", open);
  };
  const toggle = h("button", {
    type: "button", class: "gb-me", "aria-expanded": "false", "aria-controls": "gb-menu", "aria-label": `Menu for ${me.name}`,
    onclick: () => setOpen(toggle.getAttribute("aria-expanded") !== "true"),
  }, avatar(me, ME_COLOUR, 32));
  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.classList.contains("is-open")) {
      setOpen(false);
      toggle.focus();
    }
  });
  const bar = h("header", { class: "gb-header" },
    h("a", { class: "gb-brand", href: "/geobarkr/" }, logoMark(), "GeoBarkr"),
    h("div", { class: "gb-header-right" }, menu, toggle),
  );
  // The bar floats over the page; it gains its frosted backing once content scrolls under it.
  const onScroll = () => bar.classList.toggle("is-scrolled", window.scrollY > 4);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  return bar;
}

// Every page: signed in? then the header (and a note in demo mode).
// Resolves to { session, profile } (never resolves if sent to sign in).
export async function initPage({ demoNote = true } = {}) {
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
  document.body.classList.add("is-ready");
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
