// TapMap profile pages, served at /tapmap/profile/{username} (via /404.html).
// Your own profile ("me" or your username) shows everything, including follow
// requests. Other players' scores and stats are shown only if they have
// accepted your follow request.

import * as social from "/tapmap/social.js?v=12";
import { avatarElement, squarePhoto } from "/tapmap/avatar.js?v=2";
import { lineChart, barChart, YOU, THEM } from "/tapmap/profile/charts.js?v=2";
import { todayKey, formatNumber, MAX_SCORE, BULLSEYE_KM, tierFor } from "/tapmap/game.js?v=7";

// Tiers from the saved distance, so older results (when 🎯 meant under 50 km)
// use today's bands.
const tierOf = (r) => (Number.isFinite(r.km) ? tierFor(r.km) : r.tier);

const $ = (id) => document.getElementById(id);
const today = todayKey();
// (The game copies version 4 data to version 5; either counts.)
const DAILY_KEYS = ["tapmap:v5:daily", "tapmap:v4:daily"];
const TIER_CLASS = { "🎯": "t-bullseye", "🟩": "t-close", "🟨": "t-near", "🟧": "t-far", "🟥": "t-off" };

let me = null; // signed-in user
let myProfile = null;
let shown = null; // profile being viewed

const personName = (p) => (p && (p.display_name || p.username)) || "Player";
const errorText = (e) => (e && e.message) || "Something went wrong. Please try again.";
const profileUrl = (username) => `/tapmap/profile/${encodeURIComponent(username)}`;

function message(text, isError = false) {
  const el = $("profile-message");
  el.textContent = text;
  el.classList.toggle("is-error", isError);
}

let toastTimer;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2000);
}

function fieldError(id, text) {
  const el = $(id);
  el.textContent = text || "";
  el.hidden = !text;
  const input = el.previousElementSibling;
  if (input && input.classList.contains("field")) input.classList.toggle("is-invalid", Boolean(text));
}

function tierDots(rounds) {
  const dots = document.createElement("span");
  dots.className = "friend-tiers";
  dots.setAttribute("aria-hidden", "true");
  for (const r of rounds || []) {
    if (!TIER_CLASS[tierOf(r)]) continue;
    const dot = document.createElement("span");
    dot.className = `tier-dot ${TIER_CLASS[tierOf(r)]}`;
    dots.append(dot);
  }
  return dots;
}

// Have you finished today's daily? (Saved on this device or on your account.)
async function finishedToday() {
  try {
    for (const key of DAILY_KEYS) {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved && saved.date === today && Array.isArray(saved.rounds) && saved.rounds.length >= 5) return true;
    }
  } catch (e) {}
  if (!me) return false;
  try {
    return Boolean(await social.gameFor(me.id, today));
  } catch (e) {
    return false;
  }
}

// ---------- Stats, today and history ----------

async function renderDetails(person, isMe) {
  const [stats, games, done, myGames] = await Promise.all([
    social.getStats(person.id),
    social.recentGames(person.id, 60),
    isMe ? Promise.resolve(true) : finishedToday(),
    isMe ? Promise.resolve(null) : social.recentGames(me.id, 60),
  ]);
  $("stat-played").textContent = formatNumber(stats ? stats.played : 0);
  $("stat-streak").textContent = formatNumber(stats ? stats.current_streak : 0);
  $("stat-best").textContent = formatNumber(stats ? stats.best : 0);
  $("stat-average").textContent = formatNumber(stats ? stats.average : 0);

  const todayGame = games.find((g) => g.game_date === today);
  const card = $("profile-today");
  card.replaceChildren();
  if (!todayGame) {
    card.textContent = isMe ? "You haven't played today yet." : "Hasn't played today yet.";
  } else if (!done) {
    card.textContent = "Finish today's game to see their result.";
  } else {
    const total = document.createElement("span");
    total.className = "person-today-total";
    total.textContent = formatNumber(todayGame.total);
    const of = document.createElement("span");
    of.className = "of";
    of.textContent = ` / ${formatNumber(MAX_SCORE)}`;
    const scores = document.createElement("span");
    scores.className = "person-today-rounds";
    scores.textContent = (todayGame.rounds || []).map((r) => r.score).join(" · ");
    card.append(total, of, tierDots(todayGame.rounds), scores);
  }

  // Earlier games (today's is shown above, and hidden until you've played).
  const past = games.filter((g) => g.game_date !== today);
  $("history").replaceChildren(...past.map((g) => {
    const li = document.createElement("li");
    const when = document.createElement("span");
    when.className = "history-when";
    const date = new Date(`${g.game_date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    when.textContent = `No. ${g.game_number} · ${date}`;
    const total = document.createElement("span");
    total.className = "history-total";
    total.textContent = formatNumber(g.total);
    li.append(when, tierDots(g.rounds), total);
    const places = (g.rounds || []).map((r) => r.name).filter(Boolean);
    if (places.length) li.title = places.join(" · ");
    return li;
  }));
  $("history-empty").hidden = past.length > 0;

  // Today's result stays out of the charts until you've played it yourself.
  const visibleGames = done ? games : games.filter((g) => g.game_date !== today);
  if (isMe) renderMyCharts(games);
  else renderComparison(person, visibleGames, myGames || []);
}

// ---------- Charts ----------

const shortDate = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const ROUND_LABELS = ["Round 1", "Round 2", "Round 3", "Round 4", "Round 5"];
const TIER_ORDER = ["🎯", "🟩", "🟨", "🟧", "🟥"];
const TIER_LABELS = [`<${BULLSEYE_KM} km`, "<500", "<1,500", "<3,000", "3,000+"];

function roundAverages(games) {
  return ROUND_LABELS.map((_, i) => {
    const scores = games.map((g) => g.rounds && g.rounds[i] && g.rounds[i].score).filter(Number.isFinite);
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  });
}

const scorePoints = (games) => games.slice(0, 30).map((g) => ({ x: g.game_date, y: g.total }));

function renderMyCharts(games) {
  $("my-charts").hidden = games.length === 0;
  $("compare").hidden = true;
  if (!games.length) return;
  lineChart($("chart-scores"), {
    title: "Score by day (out of 1,000)",
    series: [{ name: "You", colour: YOU, points: scorePoints(games) }],
    yMax: 1000, formatX: shortDate, formatY: (v) => formatNumber(v),
  });
  barChart($("chart-rounds"), {
    title: "Average score by round (out of 100)",
    categories: ROUND_LABELS.map((_, i) => `R${i + 1}`),
    series: [{ name: "You", colour: YOU, values: roundAverages(games) }],
    yMax: 100,
  });
  const css = getComputedStyle(document.documentElement);
  const tierColours = ["--t-bullseye", "--t-close", "--t-near", "--t-far", "--t-off"].map((v) => css.getPropertyValue(v).trim());
  const counts = TIER_ORDER.map((t) => games.reduce((n, g) => n + (g.rounds || []).filter((r) => tierOf(r) === t).length, 0));
  barChart($("chart-tiers"), {
    title: "How close your guesses land (rounds)",
    categories: TIER_LABELS,
    series: [{ name: "Rounds", colour: YOU, values: counts }],
    colours: tierColours,
  });
}

function renderComparison(person, theirGames, myGames) {
  $("my-charts").hidden = true;
  const theirName = personName(person).split(" ")[0];
  $("compare-title").textContent = `You vs ${theirName}`;
  $("compare").hidden = theirGames.length === 0 && myGames.length === 0;

  // Head to head on days you both played.
  const mine = new Map(myGames.map((g) => [g.game_date, g.total]));
  const shared = theirGames.filter((g) => mine.has(g.game_date));
  const wins = shared.filter((g) => mine.get(g.game_date) > g.total).length;
  const losses = shared.filter((g) => mine.get(g.game_date) < g.total).length;
  const tiles = [["Played both", shared.length], ["You won", wins], [`${theirName} won`, losses], ["Drawn", shared.length - wins - losses]];
  $("head-to-head").replaceChildren(...tiles.map(([label, value]) => {
    const div = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = formatNumber(value);
    div.append(dt, dd);
    return div;
  }));

  lineChart($("chart-compare-scores"), {
    title: "Score by day (out of 1,000)",
    series: [
      { name: "You", colour: YOU, points: scorePoints(myGames) },
      { name: theirName, colour: THEM, points: scorePoints(theirGames) },
    ],
    yMax: 1000, formatX: shortDate, formatY: (v) => formatNumber(v),
  });
  barChart($("chart-compare-rounds"), {
    title: "Average score by round (out of 100)",
    categories: ROUND_LABELS.map((_, i) => `R${i + 1}`),
    series: [
      { name: "You", colour: YOU, values: roundAverages(myGames) },
      { name: theirName, colour: THEM, values: roundAverages(theirGames) },
    ],
    yMax: 100,
  });
}

// ---------- People lists (own profile) ----------

function personRow(person, actions = [], note = "") {
  const li = document.createElement("li");
  const link = document.createElement("a");
  link.className = "person-link";
  link.href = profileUrl(person.username);
  link.append(avatarElement(person, "sm"));
  const text = document.createElement("span");
  text.className = "person-text";
  const name = document.createElement("span");
  name.className = "person-name";
  name.textContent = personName(person);
  const handle = document.createElement("span");
  handle.className = "person-handle";
  handle.textContent = `@${person.username}${note ? ` · ${note}` : ""}`;
  text.append(name, handle);
  link.append(text);
  const buttons = document.createElement("span");
  buttons.className = "person-actions";
  for (const { label, action, primary } of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary ? "chip-button is-primary" : "chip-button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await action(person);
      } catch (error) {
        message(errorText(error), true);
        button.disabled = false;
      }
    });
    buttons.append(button);
  }
  li.append(link, buttons);
  return li;
}

async function renderPeople() {
  const [requests, following, followers] = await Promise.all([
    social.listRequests(me.id),
    social.listFollowing(me.id),
    social.listFollowers(me.id),
  ]);
  $("requests-section").hidden = requests.length === 0;
  $("requests-list").replaceChildren(...requests.map((p) => personRow(p, [
    { label: "Accept", primary: true, action: async () => { await social.acceptRequest(me.id, p.id); await renderPeople(); } },
    { label: "Decline", action: async () => { await social.endFollow(p.id, me.id); await renderPeople(); } },
  ])));
  $("following-list").replaceChildren(...following.map((p) => personRow(p, [
    { label: p.status === "pending" ? "Cancel" : "Unfollow", action: async () => { await social.endFollow(me.id, p.id); await renderPeople(); await runSearch(); } },
  ], p.status === "pending" ? "requested" : "")));
  $("following-empty").hidden = following.length > 0;
  $("followers-list").replaceChildren(...followers.map((p) => personRow(p, [
    { label: "Remove", action: async () => { await social.endFollow(p.id, me.id); await renderPeople(); } },
  ])));
  $("followers-empty").hidden = followers.length > 0;
}

let searchTimer;
let searchSeq = 0;
async function runSearch() {
  const query = $("people-search").value.trim();
  const status = $("search-status");
  const results = $("people-results");
  const seq = ++searchSeq;
  if (query.length < 2) {
    results.replaceChildren();
    status.textContent = query ? "Type at least 2 characters." : "";
    return;
  }
  status.textContent = "Searching…";
  try {
    const found = await social.searchProfiles(query, me.id);
    // Relationship labels are a nice-to-have; search still works without them.
    const following = await social.listFollowing(me.id).catch(() => []);
    if (seq !== searchSeq) return;
    const state = new Map(following.map((p) => [p.id, p.status]));
    results.replaceChildren(...found.map((p) => {
      const s = state.get(p.id);
      if (s === "accepted") return personRow(p, [], "following");
      if (s === "pending") return personRow(p, [], "requested");
      return personRow(p, [{ label: "Follow", primary: true, action: async () => {
        await social.requestFollow(me.id, p.id);
        await Promise.all([renderPeople(), runSearch()]);
      } }]);
    }));
    status.textContent = found.length ? "" : `No players found for “${query}”.`;
  } catch (error) {
    if (seq !== searchSeq) return;
    results.replaceChildren();
    status.textContent = `Search failed: ${errorText(error)}`;
  }
}

// ---------- Rendering ----------

function renderHead(person, isMe) {
  $("profile-avatar").replaceChildren(avatarElement(person, "lg"));
  $("profile-eyebrow").textContent = isMe ? "Your profile" : "Player";
  $("profile-name").textContent = personName(person);
  $("profile-handle").textContent = `@${person.username}`;
  document.title = `${personName(person)} (@${person.username}) · TapMap`;
}

async function renderFollowButton(person) {
  const button = $("profile-action");
  const state = await social.followStatus(me.id, person.id);
  button.hidden = false;
  button.disabled = false;
  button.className = state ? "secondary-button" : "primary-button";
  button.textContent = state === "accepted" ? "Unfollow" : state === "pending" ? "Cancel request" : "Follow";
  button.onclick = async () => {
    button.disabled = true;
    try {
      if (state) await social.endFollow(me.id, person.id);
      else await social.requestFollow(me.id, person.id);
      await render();
    } catch (error) {
      message(errorText(error), true);
      button.disabled = false;
    }
  };
  return state;
}

async function render() {
  const person = shown;
  const isMe = Boolean(me && person.id === me.id);
  renderHead(person, isMe);
  $("profile").hidden = false;
  $("own-sections").hidden = !isMe;
  $("invite-button").hidden = !isMe;
  $("share-profile-button").hidden = !isMe;
  $("signed-out-note").hidden = Boolean(me);
  $("profile-action").hidden = true;
  message("");

  if (!me) {
    $("profile-details").hidden = true;
    $("profile-private").hidden = true;
    // Signing in goes through the invite flow: create an account or sign in,
    // then asked whether to follow this player, then back to this page.
    localStorage.setItem("tapmap:next", profileUrl(person.username));
    $("sign-in-link").href = `/tapmap/?invite=${encodeURIComponent(person.username)}`;
    $("sign-in-link").textContent = "Create account or sign in";
    $("signed-out-text").textContent = wantsFollow
      ? `${personName(person)} shared their TapMap profile. Create a free account or sign in to follow them and see each other's scores.`
      : "Sign in to follow and see their scores.";
    return;
  }

  $("photo-controls").hidden = !isMe;
  if (isMe) {
    $("photo-remove").hidden = !person.avatar_url;
    $("profile-private").hidden = true;
    $("profile-details").hidden = false;
    $("display-name").value = person.display_name || "";
    $("username").value = person.username;
    const locked = social.isUsernameAccount(me);
    $("username").readOnly = locked;
    $("username-lock").hidden = !locked;
    await Promise.all([renderDetails(person, true), renderPeople(), renderChallenges()]);
    return;
  }

  const state = await renderFollowButton(person);
  if (wantsFollow && !state) offerFollow(person);
  wantsFollow = false;
  const visible = state === "accepted";
  $("profile-details").hidden = !visible;
  $("profile-private").hidden = visible;
  $("profile-private").textContent = state === "pending"
    ? "Request sent. Once they accept, you'll see their scores and stats here."
    : "Their scores and stats are private. Follow to send a request.";
  if (visible) await renderDetails(person, false);
}

// ---------- Challenges (your own profile) ----------

const KIND_LABELS = { practice: "Random places", photo: "Photos" };
const kindLabel = (c) => (c.kind === "daily" && c.game_number ? `TapMap No. ${c.game_number}` : KIND_LABELS[c.kind] || "Challenge");
const timestampDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// Sent and played challenges in one list, newest first.
async function renderChallenges() {
  let data;
  try {
    data = await social.myChallenges(me.id);
  } catch (error) {
    // (Hidden until setup.sql has been re-run to create the challenge tables.)
    console.warn("Challenges:", error);
    $("challenges-section").hidden = true;
    return;
  }
  $("challenges-section").hidden = false;
  const entries = [];
  for (const c of data.sent) {
    const others = (c.challenge_results || []).filter((r) => r.user_id !== me.id);
    const best = others.reduce((top, r) => (!top || r.total > top.total ? r : top), null);
    entries.push({
      id: c.id,
      when: c.created_at,
      title: kindLabel(c),
      sub: `You sent it · ${others.length ? `${others.length} played` : "no one's played yet"}`,
      mine: c.total,
      theirs: best ? best.total : null,
      theirName: best ? personName(best.profiles) : "",
    });
  }
  for (const r of data.played) {
    const c = r.challenges;
    if (!c || c.created_by === me.id) continue; // already listed as sent
    const from = c.by_name || (c.profiles ? personName(c.profiles) : "A friend");
    entries.push({ id: c.id, when: r.created_at, title: kindLabel(c), sub: `From ${from}`, mine: r.total, theirs: c.total, theirName: from });
  }
  entries.sort((a, b) => (a.when < b.when ? 1 : -1));

  const won = entries.filter((e) => e.theirs !== null && e.mine > e.theirs).length;
  const decided = entries.filter((e) => e.theirs !== null).length;
  $("challenges-summary").textContent = entries.length
    ? `${entries.length} challenge${entries.length === 1 ? "" : "s"} sent and played${decided ? ` · won ${won} of ${decided}` : ""}.`
    : "Challenges you've sent and played.";
  $("challenges-list").replaceChildren(...entries.map((e) => {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.className = "archive-item challenge-item";
    link.href = `/tapmap/challenge/${e.id}`;
    const text = document.createElement("span");
    text.className = "challenge-text";
    const title = document.createElement("span");
    title.className = "archive-title";
    title.textContent = e.title;
    const sub = document.createElement("span");
    sub.className = "archive-date";
    sub.textContent = `${e.sub} · ${timestampDate(e.when)}`;
    text.append(title, sub);
    const status = document.createElement("span");
    status.className = "archive-status";
    status.textContent = e.theirs === null ? formatNumber(e.mine) : `${formatNumber(e.mine)} v ${formatNumber(e.theirs)}`;
    if (e.theirs !== null && e.mine !== e.theirs) status.classList.add(e.mine > e.theirs ? "is-done" : "is-lost");
    status.title = e.theirs === null ? "Your score" : `You ${e.mine}, ${e.theirName} ${e.theirs}`;
    link.append(text, status);
    li.append(link);
    return li;
  }));
  $("challenges-empty").hidden = entries.length > 0;
}

$("challenges-toggle").addEventListener("click", () => {
  const open = $("challenges-body").hidden;
  $("challenges-body").hidden = !open;
  $("challenges-toggle").setAttribute("aria-expanded", String(open));
  $("challenges-toggle").querySelector(".practice-arrow").textContent = open ? "↑" : "↓";
});

// ---------- Follow links ----------

// A shared profile link ("Follow me on TapMap") ends in ?follow=1: the page
// then asks whether to follow, as an invite link does.
let wantsFollow = new URLSearchParams(window.location.search).has("follow");
if (wantsFollow) window.history.replaceState(null, "", window.location.pathname);

function offerFollow(person) {
  $("follow-prompt-avatar").replaceChildren(avatarElement(person, "lg"));
  $("follow-prompt-title").textContent = personName(person);
  $("follow-prompt-handle").textContent = `@${person.username}`;
  $("follow-prompt-text").textContent = `Follow ${personName(person)} on TapMap? Once they accept, you'll follow each other and see each other's scores.`;
  $("follow-prompt-message").textContent = "";
  $("follow-prompt-yes").onclick = async () => {
    $("follow-prompt-yes").disabled = true;
    try {
      await social.requestFollow(me.id, person.id);
      $("follow-prompt").hidden = true;
      toast(`Follow request sent to @${person.username}`);
      await render();
    } catch (error) {
      $("follow-prompt-message").textContent = errorText(error);
    } finally {
      $("follow-prompt-yes").disabled = false;
    }
  };
  $("follow-prompt-no").onclick = () => { $("follow-prompt").hidden = true; };
  $("follow-prompt").hidden = false;
  $("follow-prompt-yes").focus({ preventScroll: true });
}

async function shareText(text, copiedMessage) {
  if (navigator.share) {
    try {
      // The link is inside the text, so apps like WhatsApp show one message.
      await navigator.share({ text });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(copiedMessage);
}

$("share-profile-button").addEventListener("click", () => {
  const url = `${window.location.origin}${profileUrl(myProfile.username)}?follow=1`;
  shareText(`Follow me on TapMap: ${url}`, "Profile link copied");
});

// ---------- Actions ----------

$("photo-input").addEventListener("change", async () => {
  const file = $("photo-input").files[0];
  $("photo-input").value = "";
  if (!file) return;
  fieldError("photo-error", "");
  if (!file.type.startsWith("image/")) {
    fieldError("photo-error", "Choose an image file.");
    return;
  }
  message("Uploading photo…");
  try {
    const blob = await squarePhoto(file);
    myProfile = await social.uploadAvatar(me.id, blob);
    shown = myProfile;
    await render();
    message("Photo updated.");
  } catch (error) {
    message("");
    fieldError("photo-error", errorText(error));
  }
});

$("photo-remove").addEventListener("click", async () => {
  fieldError("photo-error", "");
  try {
    myProfile = await social.removeAvatar(me.id);
    shown = myProfile;
    await render();
    message("Photo removed.");
  } catch (error) {
    fieldError("photo-error", errorText(error));
  }
});

$("invite-button").addEventListener("click", () => {
  const url = `${window.location.origin}/tapmap/?invite=${encodeURIComponent(myProfile.username)}`;
  const first = personName(myProfile).trim().split(/\s+/)[0];
  shareText(`${first} has invited you to play TapMap, the daily geography game. Sign up here: ${url}`, "Invite copied");
});

$("profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  fieldError("display-name-error", "");
  fieldError("username-field-error", "");
  const locked = social.isUsernameAccount(me);
  const username = locked ? myProfile.username : $("username").value.trim().toLowerCase();
  const displayName = $("display-name").value.trim();
  let ok = true;
  if (!displayName) { fieldError("display-name-error", "Enter a display name."); ok = false; }
  if (!social.USERNAME_PATTERN.test(username)) { fieldError("username-field-error", "Usernames are 3–20 lowercase letters, numbers or _."); ok = false; }
  if (!ok) return;
  try {
    myProfile = await social.updateProfile(me.id, { username, displayName });
    shown = myProfile;
    if (!window.location.pathname.endsWith(`/${myProfile.username}`)) {
      window.history.replaceState(null, "", profileUrl(myProfile.username));
    }
    await render();
    message("Profile saved.");
  } catch (error) {
    if (error && error.code === "23505") fieldError("username-field-error", "That username is taken.");
    else fieldError("display-name-error", errorText(error));
  }
});
["display-name", "username"].forEach((id) => {
  $(id).addEventListener("input", () => fieldError(id === "username" ? "username-field-error" : "display-name-error", ""));
});

$("people-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 250);
});

$("sign-out").addEventListener("click", async () => {
  await social.signOut();
  window.location.href = "/tapmap/";
});

// ---------- Entry point ----------

export async function showProfile(username) {
  const loading = $("profile-loading");
  try {
    await social.initSocial();
    me = await social.currentUser();
    if (me) myProfile = await social.getProfile(me.id);
    // A saved sign-in for an account that no longer exists counts as signed out.
    if (me && !myProfile) {
      const still = await social.verifiedUser().catch(() => null);
      if (still) await social.signOut();
      me = null;
    }

    if (username === "me") {
      if (!myProfile) {
        localStorage.setItem("tapmap:next", "/tapmap/profile/me");
        window.location.replace("/tapmap/?signin=1");
        return;
      }
      window.history.replaceState(null, "", profileUrl(myProfile.username));
      shown = myProfile;
    } else {
      shown = await social.getProfileByUsername(username);
    }

    loading.hidden = true;
    if (!shown) {
      $("no-player").hidden = false;
      $("no-player-text").textContent = `There's no player called @${username}.`;
      document.title = "Player not found · TapMap";
      return;
    }
    await render();
  } catch (error) {
    console.error(error);
    loading.textContent = `Couldn't load this profile. ${errorText(error)}`;
  }
}
