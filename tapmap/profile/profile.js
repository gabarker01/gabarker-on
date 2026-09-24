// TapMap profile pages, served at /tapmap/profile/{username} (via /404.html).
// Your own profile ("me" or your username) shows everything, including follow
// requests. Other players' scores and stats are shown only if they have
// accepted your follow request.

import * as social from "/tapmap/social.js?v=6";
import { avatarElement } from "/tapmap/avatar.js";
import { utcDateKey, formatNumber, MAX_SCORE } from "/tapmap/game.js";

const $ = (id) => document.getElementById(id);
const today = utcDateKey();
const DAILY_KEY = "tapmap:v4:daily";
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
    if (!TIER_CLASS[r.tier]) continue;
    const dot = document.createElement("span");
    dot.className = `tier-dot ${TIER_CLASS[r.tier]}`;
    dots.append(dot);
  }
  return dots;
}

// Have you finished today's daily? (Saved on this device or on your account.)
async function finishedToday() {
  try {
    const saved = JSON.parse(localStorage.getItem(DAILY_KEY));
    if (saved && saved.date === today && Array.isArray(saved.rounds) && saved.rounds.length >= 5) return true;
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
  const [stats, games, done] = await Promise.all([
    social.getStats(person.id),
    social.recentGames(person.id, 30),
    isMe ? Promise.resolve(true) : finishedToday(),
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
  $("signed-out-note").hidden = Boolean(me);
  $("profile-action").hidden = true;
  message("");

  if (!me) {
    $("profile-details").hidden = true;
    $("profile-private").hidden = true;
    localStorage.setItem("tapmap:next", profileUrl(person.username));
    return;
  }

  if (isMe) {
    $("profile-private").hidden = true;
    $("profile-details").hidden = false;
    $("display-name").value = person.display_name || "";
    $("username").value = person.username;
    const locked = social.isUsernameAccount(me);
    $("username").readOnly = locked;
    $("username-lock").hidden = !locked;
    await Promise.all([renderDetails(person, true), renderPeople()]);
    return;
  }

  const state = await renderFollowButton(person);
  const visible = state === "accepted";
  $("profile-details").hidden = !visible;
  $("profile-private").hidden = visible;
  $("profile-private").textContent = state === "pending"
    ? "Request sent. Once they accept, you'll see their scores and stats here."
    : "Their scores and stats are private. Follow to send a request.";
  if (visible) await renderDetails(person, false);
}

// ---------- Actions ----------

$("invite-button").addEventListener("click", async () => {
  const url = `${window.location.origin}/tapmap/?invite=${encodeURIComponent(myProfile.username)}`;
  const text = `Play TapMap with me: guess five places on the globe each day. I'm @${myProfile.username}.`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "TapMap", text, url });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch (error) {
    const area = document.createElement("textarea");
    area.value = url;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast("Invite link copied");
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
