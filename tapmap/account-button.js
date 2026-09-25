// The profile button in the top bar of the profile, challenge and practice
// pages (the game page has its own): your photo or initials when signed in,
// with the number of follow requests; the outline icon when signed out, which
// opens sign-in and then comes back to this page.
import * as social from "/tapmap/social.js?v=13";
import { avatarElement } from "/tapmap/avatar.js?v=2";

const NEXT_KEY = "tapmap:next"; // page to return to after signing in (see tapmap.js)
const ICON = '<svg class="icon-person" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 19.5c1.2-3.4 4-5 7-5s5.8 1.6 7 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

// Where to send someone to sign in or create an account, coming back to
// `next` (this page by default) afterwards.
export function signInHref(next = window.location.pathname + window.location.search) {
  try { localStorage.setItem(NEXT_KEY, next); } catch (e) {}
  return "/tapmap/?signin=1";
}

export async function mountAccountButton(container) {
  if (!container || !social.socialEnabled()) return;
  const button = document.createElement("a");
  button.className = "ghost-button account-button";
  button.href = "/tapmap/?signin=1";
  button.setAttribute("aria-label", "Sign in");
  button.innerHTML = `${ICON}<span class="account-avatar" hidden></span><span class="request-badge" hidden></span>`;
  let signedIn = false;
  button.addEventListener("click", () => {
    if (!signedIn) signInHref();
  });
  container.append(button);

  try {
    await social.initSocial();
    const me = await social.currentUser();
    const profile = me ? await social.getProfile(me.id) : null;
    if (!profile) return;
    signedIn = true;
    button.href = `/tapmap/profile/${encodeURIComponent(profile.username)}`;
    button.classList.add("is-signed-in");
    button.querySelector(".icon-person").style.display = "none";
    const avatar = button.querySelector(".account-avatar");
    avatar.replaceChildren(avatarElement(profile, "sm"));
    avatar.hidden = false;
    const name = profile.display_name || profile.username;
    button.setAttribute("aria-label", `Your profile: ${name}`);
    const requests = await social.listRequests(me.id).catch(() => []);
    if (requests.length) {
      const badge = button.querySelector(".request-badge");
      badge.textContent = String(requests.length);
      badge.hidden = false;
      button.setAttribute("aria-label", `Your profile: ${name}, ${requests.length} follow request${requests.length > 1 ? "s" : ""}`);
    }
  } catch (error) {
    console.warn("Profile button:", error);
  }
}
