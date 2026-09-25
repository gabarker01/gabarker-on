// The challenge page, /tapmap/challenge/{id} (served by /404.html): who sent
// it and their score, a button to play it, and everyone's results that you
// can see (you sent it or played it).
import * as social from "/tapmap/social.js?v=15";
import { avatarElement } from "/tapmap/avatar.js?v=2";
import { signInHref } from "/tapmap/account-button.js?v=4";
import { formatNumber, gameNumber, todayKey, dateForNumber, MAX_SCORE } from "/tapmap/game.js?v=8";

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

// What kind of game the challenge is, for the heading and the sentence.
const KIND_LABELS = { daily: "Daily game", practice: "Random places", photo: "Photos" };
function describe(row) {
  if (row.kind === "daily" && row.game_number) {
    const date = new Date(`${dateForNumber(row.game_number)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
    return `TapMap No. ${row.game_number}, the daily game for ${date}`;
  }
  if (row.kind === "photo") return "five places shown only as photos";
  return "five random places, named each round";
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

// Played it already, or it's yours: the challenge's results (your score and
// globe, and everyone in it) are on the game page, at this same address.
const CREATED_KEY = "tapmap:v5:created-challenges"; // challenges made on this device (see tapmap.js)
function showResults(id) {
  window.location.replace(`/tapmap/?c=${encodeURIComponent(id)}`);
}
function playedHere(id) {
  try {
    const played = (JSON.parse(localStorage.getItem(RESULTS_KEY)) || {})[id];
    const made = (JSON.parse(localStorage.getItem(CREATED_KEY)) || {})[id];
    return Boolean((played && Array.isArray(played.rounds) && played.rounds.length >= 5) || made);
  } catch (e) {
    return false;
  }
}

export async function showChallenge(id) {
  if (playedHere(id)) return showResults(id);
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
  // Your own practice challenge: straight to its results.
  if (isSender && row.kind !== "daily") return showResults(id);
  const url = `${window.location.origin}/tapmap/challenge/${id}`;
  const mine = localResult(id);
  // A daily-game challenge for a future date (the sender's time zone is ahead)
  // plays as practice places, so it's always playable.
  const tooEarly = row.kind === "daily" && row.game_number > gameNumber(todayKey());

  document.title = `${senderName}'s challenge · TapMap`;
  $("challenge-eyebrow").textContent = `Challenge · ${KIND_LABELS[row.kind] || "Practice"}`;
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
  // Everyone's results are public with the link, signed in or not.
  let results = [];
  try {
    results = await social.fetchChallengeResults(id);
  } catch (error) {
    console.warn(error);
  }
  // Played it (on another device): its results.
  if (me && row.kind !== "daily" && results.some((r) => r.user_id === me.id)) return showResults(id);
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
  // Players without an account are counted, not listed.
  social.anonymousChallengePlayers(id).then((count) => {
    const others = $("challenge-anonymous");
    // (Your own result from this device is already listed as "You".)
    const shown = mine && !me ? count - 1 : count;
    others.hidden = shown < 1;
    others.textContent = `+ ${shown} more ${shown === 1 ? "person" : "people"} played without an account.`;
  }).catch(() => {});

  // Signed out: results aren't saved under your name, so offer sign-in.
  const note = $("challenge-results-note");
  note.hidden = Boolean(me);
  if (!me) {
    // "Sign in" opens sign-in / create account, then comes back here.
    const link = document.createElement("a");
    link.href = "/tapmap/?signin=1";
    link.textContent = "Sign in";
    link.addEventListener("click", () => signInHref(`/tapmap/challenge/${id}`));
    note.replaceChildren(link, " before you play to save your result under your name.");
  }
}
