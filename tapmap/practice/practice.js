// Practice menu: random places, satellite, or any earlier daily game.
import { ROUNDS, todayKey, gameNumber, dateForNumber, totalScore, formatNumber } from "/tapmap/game.js?v=4";

const ARCHIVE_KEY = "tapmap:v5:archive"; // past games played on this device (see tapmap.js)
const $ = (id) => document.getElementById(id);

function savedPastGames() {
  try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY)) || {}; } catch (e) { return {}; }
}

const shortDate = (dateKey) => new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-GB", {
  weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
});

function renderPastDays() {
  const todayNumber = gameNumber(todayKey());
  const saved = savedPastGames();
  const items = [];
  for (let n = todayNumber - 1; n >= 1; n--) {
    const rounds = saved[n] && Array.isArray(saved[n].rounds) ? saved[n].rounds : [];
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.className = "archive-item";
    link.href = `/tapmap/?play=archive&n=${n}`;
    const title = document.createElement("span");
    title.className = "archive-title";
    title.textContent = `No. ${n}`;
    const when = document.createElement("span");
    when.className = "archive-date";
    when.textContent = shortDate(dateForNumber(n));
    const status = document.createElement("span");
    status.className = "archive-status";
    if (rounds.length >= ROUNDS) {
      status.textContent = formatNumber(totalScore(rounds));
      status.classList.add("is-done");
    } else {
      status.textContent = rounds.length ? `Round ${rounds.length + 1}/${ROUNDS}` : "Play";
    }
    link.append(title, when, status);
    li.append(link);
    items.push(li);
  }
  $("past-list").replaceChildren(...items);
  $("past-empty").hidden = items.length > 0;
}

$("past-toggle").addEventListener("click", () => {
  const open = $("past-days").hidden;
  $("past-days").hidden = !open;
  $("past-toggle").setAttribute("aria-expanded", String(open));
  $("past-toggle").querySelector(".practice-arrow").textContent = open ? "↑" : "↓";
  if (open) renderPastDays();
});

// Coming back from a past game, show the list again.
if (window.location.hash === "#past") $("past-toggle").click();
