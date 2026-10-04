// Global leaderboards: today's game, this week (Monday to Sunday) and all
// time, for every player with an account. Points are daily-game totals.
import * as social from "/tapmap/social.js?v=18";
import { avatarElement } from "/tapmap/avatar.js?v=2";
import { mountAccountButton, signInHref } from "/tapmap/account-button.js?v=7";
import { todayKey, gameNumber, formatNumber } from "/tapmap/game.js?v=9";

mountAccountButton(document.getElementById("account-slot"));

const $ = (id) => document.getElementById(id);
const personName = (p) => (p && (p.display_name || p.username)) || "Player";
const profileUrl = (username) => `/tapmap/profile/${encodeURIComponent(username)}`;
const shortDate = (dateKey) => new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const addDays = (dateKey, n) => new Date(Date.parse(`${dateKey}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekStart = (dateKey) => addDays(dateKey, -((new Date(`${dateKey}T12:00:00Z`).getUTCDay() + 6) % 7));

const today = todayKey();
const PERIODS = {
  day: { label: () => `TapMap No. ${gameNumber(today)} · ${shortDate(today)}`, empty: "Nobody with an account has played today's game yet." },
  week: { label: () => `${shortDate(weekStart(today))} – ${shortDate(addDays(weekStart(today), 6))}`, empty: "Nobody with an account has played this week yet." },
  all: { label: () => "Since TapMap No. 1", empty: "No games yet." },
};

let me = null;
let current = null;
const cache = {};

function row(r) {
  const you = Boolean(me && r.user_id === me.id);
  const li = document.createElement("li");
  if (you) li.className = "is-you";
  const rank = document.createElement("span");
  rank.className = "league-rank";
  rank.textContent = String(r.rank);
  const who = document.createElement("a");
  who.className = "person-link";
  who.href = profileUrl(r.username);
  who.append(avatarElement({ id: r.user_id, username: r.username, display_name: r.display_name, avatar_url: r.avatar_url }, "sm"));
  const name = document.createElement("span");
  name.className = "friend-name";
  name.textContent = you ? "You" : personName(r);
  who.append(name);
  const played = document.createElement("span");
  played.className = "league-played";
  played.textContent = current === "day" ? "" : `${r.played} ${r.played === 1 ? "day" : "days"}`;
  const points = document.createElement("span");
  points.className = "friend-total";
  points.textContent = formatNumber(r.points);
  li.append(rank, who, played, points);
  return li;
}

async function show(period) {
  current = period;
  document.querySelectorAll(".board-tab").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.period === period)));
  $("board-dates").textContent = PERIODS[period].label();
  const list = $("board-list");
  const empty = $("board-empty");
  empty.hidden = true;
  list.classList.add("is-loading");
  try {
    cache[period] ||= await social.leaderboard(period, period === "all" ? null : today);
    if (current !== period) return;
    const rows = cache[period];
    // (Your own row, if you're outside the top 50, comes after a gap.)
    const items = [];
    rows.forEach((r, i) => {
      if (i > 0 && r.rank > rows[i - 1].rank + 1 && me && r.user_id === me.id) {
        const gap = document.createElement("li");
        gap.className = "board-gap";
        gap.textContent = "···";
        items.push(gap);
      }
      items.push(row(r));
    });
    list.replaceChildren(...items);
    empty.textContent = PERIODS[period].empty;
    empty.hidden = rows.length > 0;
  } catch (error) {
    console.warn("Leaderboard:", error);
    list.replaceChildren();
    empty.textContent = "Leaderboards aren't available right now.";
    empty.hidden = false;
  } finally {
    list.classList.remove("is-loading");
  }
}

document.querySelectorAll(".board-tab").forEach((tab) => tab.addEventListener("click", () => show(tab.dataset.period)));
$("board-signin-link").addEventListener("click", () => signInHref("/tapmap/leaderboard/"));

(async () => {
  if (!social.socialEnabled()) {
    $("board-empty").textContent = "Leaderboards aren't available right now.";
    $("board-empty").hidden = false;
    return;
  }
  try {
    await social.initSocial();
    me = await social.currentUser();
  } catch (error) {
    console.warn(error);
  }
  $("board-signin").hidden = Boolean(me);
  const start = new URLSearchParams(window.location.search).get("p");
  show(PERIODS[start] ? start : "day");
})();
