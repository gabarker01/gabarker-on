// The challenge page, /tapmap/challenge/{id} (served by /404.html): who sent
// it and their score, a button to play it, and everyone's results that you
// can see (you sent it or played it).
import * as social from "/tapmap/social.js?v=12";
import { avatarElement } from "/tapmap/avatar.js?v=2";
import { formatNumber, gameNumber, todayKey, dateForNumber, MAX_SCORE } from "/tapmap/game.js?v=7";

const $ = (id) => document.getElementById(id);
const RESULTS_KEY = "tapmap:v5:challenge-results"; // your results on this device (see tapmap.js)
const personName = (p) => (p && (p.display_name || p.username)) || "Player";
const profileUrl = (username) => `/tapmap/profile/${encodeURIComponent(username)}`;

function localResult(id) {
  try { return (JSON.parse(localStorage.getItem(RESULTS_KEY)) || {})[id] || null; } catch (e) { return null; }
}

let toastTimer;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 1800);
}

function describe(row) {
  if (row.kind === "daily" && row.game_number) {
    const date = new Date(`${dateForNumber(row.game_number)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
    return `TapMap No. ${row.game_number} (${date})`;
  }
  return row.kind === "photo" ? "five places shown as photos" : "five random places";
}

function resultRow(rank, person, total, { you = false, sender = false, note = "" } = {}) {
  const li = document.createElement("li");
  if (you) li.className = "is-you";
  const n = document.createElement("span");
  n.className = "league-rank";
  n.textContent = rank ? String(rank) : "–";
  const who = document.createElement(person && person.username ? "a" : "span");
  who.className = "person-link";
  if (person && person.username) who.href = profileUrl(person.username);
  who.append(avatarElement(person || { username: "?" }, "sm"));
  const name = document.createElement("span");
  name.className = "friend-name";
  name.textContent = you ? "You" : personName(person);
  who.append(name);
  const tag = document.createElement("span");
  tag.className = "league-played";
  tag.textContent = note || (sender ? "sent it" : "");
  const score = document.createElement("span");
  score.className = "friend-total";
  score.textContent = formatNumber(total);
  li.append(n, who, tag, score);
  return li;
}

export async function showChallenge(id) {
  const loading = $("profile-loading");
  let row = null;
  try {
    row = await social.fetchChallenge(id);
  } catch (error) {
    console.error(error);
  }
  loading.hidden = true;
  if (!row) {
    $("no-challenge").hidden = false;
    document.title = "Challenge not found · TapMap";
    return;
  }

  let me = null;
  try {
    await social.initSocial();
    me = await social.currentUser();
  } catch (error) {
    console.warn(error);
  }

  const sender = row.profiles || null;
  const senderName = row.by_name || (sender ? personName(sender) : "A friend");
  const isSender = Boolean(me && row.created_by === me.id);
  const url = `${window.location.origin}/tapmap/challenge/${id}`;
  const mine = localResult(id);
  // A daily-game challenge for a future date (the sender's time zone is ahead)
  // plays as practice places, so it's always playable.
  const tooEarly = row.kind === "daily" && row.game_number > gameNumber(todayKey());

  document.title = `${senderName}'s challenge · TapMap`;
  $("challenge-heading").textContent = isSender ? "Your challenge" : `${senderName} challenges you`;
  $("challenge-lead").textContent = `${isSender ? "You" : senderName} scored ${formatNumber(row.total)} of ${formatNumber(MAX_SCORE)} on ${describe(row)}.`
    + (isSender ? " Share it and see how everyone does." : " Play the same five places and see how you compare, round by round.")
    + (tooEarly ? " (It's tomorrow's game where you are, so it plays as practice.)" : "");
  const play = $("challenge-play");
  play.href = `/tapmap/?c=${id}`;
  play.textContent = mine ? "See how you compare" : isSender ? "Play it again" : "Play the challenge";
  play.hidden = isSender && !mine;
  $("challenge-share").onclick = async () => {
    const text = `Can you beat ${isSender ? "my" : `${senderName}'s`} ${formatNumber(row.total)} on TapMap? Same five places: ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("Challenge link copied");
    } catch (error) {
      toast(url);
    }
  };
  $("challenge-view").hidden = false;

  // Results: the sender, then everyone you're allowed to see.
  const rows = [{ person: sender || { username: "", display_name: senderName }, total: row.total, sender: true, you: isSender }];
  let results = [];
  let canSee = false;
  if (me) {
    try {
      results = await social.challengeResults(id);
      canSee = isSender || results.some((r) => r.user_id === me.id);
    } catch (error) {
      console.warn(error);
    }
  }
  for (const r of results) {
    if (r.user_id === row.created_by) continue; // the sender is already listed
    rows.push({ person: r.profiles, total: r.total, you: Boolean(me && r.user_id === me.id) });
  }
  // Played on this device but not saved to an account (signed out).
  if (mine && !rows.some((r) => r.you)) rows.push({ person: { username: "", display_name: "You" }, total: mine.total, you: true, note: "this device" });
  rows.sort((a, b) => b.total - a.total);
  let rank = 0;
  let last = null;
  $("challenge-results").replaceChildren(...rows.map((r, i) => {
    if (r.total !== last) rank = i + 1;
    last = r.total;
    return resultRow(rank, r.person, r.total, r);
  }));
  const note = $("challenge-results-note");
  note.hidden = canSee;
  note.textContent = !me
    ? "Sign in before you play to save your result and see everyone else's."
    : "Play it to see everyone else's results.";
}
