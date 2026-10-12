// Page set-up (sign-in check + header) and small DOM helpers.
import { isConfigured, requireSession, getProfile, signOut } from "./supabase.js";

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

export function param(name) {
  return new URLSearchParams(location.search).get(name);
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

function notConfigured() {
  document.body.replaceChildren(h("main", { class: "gb-page gb-notice" },
    h("img", { src: "/geobarkr/assets/logo.png", alt: "GeoBarkr" }),
    h("p", { class: "gb-lede" }, "GeoBarkr isn't switched on yet."),
    h("p", { class: "gb-muted" }, "Its Supabase project needs setting up first: follow the checklist in geobarkr/README.md."),
  ));
}

function header(profile) {
  const links = [
    ["/geobarkr/", "Play"],
    ["/geobarkr/games/", "My games"],
    ["/geobarkr/leaderboard/", "Leaderboard"],
  ];
  if (profile?.role === "admin") links.push(["/geobarkr/admin/", "Admin"]);

  const menu = h("nav", { class: "gb-menu", id: "gb-menu", "aria-label": "GeoBarkr" },
    links.map(([href, label]) => h("a", {
      href, "aria-current": location.pathname === href ? "page" : false,
    }, label)),
    h("button", { type: "button", class: "gb-menu-signout", onclick: () => signOut() }, "Sign out"),
  );
  const toggle = h("button", {
    type: "button", class: "gb-menu-toggle", "aria-expanded": "false", "aria-controls": "gb-menu",
    onclick: () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      menu.classList.toggle("is-open", open);
    },
  }, h("span", { class: "gb-menu-name" }, profile?.display_name || "Menu"), h("span", { "aria-hidden": "true" }, " ☰"));

  return h("header", { class: "gb-header" },
    h("a", { class: "gb-logo", href: "/geobarkr/" }, h("img", { src: "/geobarkr/assets/logo.png", alt: "GeoBarkr home" })),
    toggle,
    menu,
  );
}

// Every page: configured? signed in? then the header. Resolves to
// { session, profile } (never resolves if the visitor is sent to sign in).
export async function initPage() {
  if (!isConfigured()) {
    notConfigured();
    return new Promise(() => {});
  }
  const session = await requireSession();
  const profile = await getProfile().catch(() => null);
  const slot = $("#gb-header");
  if (slot) slot.replaceWith(header(profile));
  document.body.classList.add("is-ready");
  return { session, profile };
}

// The QR code for a join link, as an SVG element.
export async function qrCode(text) {
  const { loadScript } = await import("./load.js");
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
