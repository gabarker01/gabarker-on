// Keeping a game screen up to date: the game's private Realtime channel
// ("game:<id>", sent by the database on every change) plus a slow re-check as
// a safety net, and another whenever the screen comes back into view.
import { getClient, getSession } from "./supabase.js";
import { getGameState } from "./api.js";
import { POLL_MS } from "./config.js";

// Calls refresh() now and after every change. Overlapping calls are merged:
// refresh never runs twice at once, and a change during a refresh triggers one
// more. Returns { refresh, stop }: refresh() re-checks now (after your own
// action), stop() stops watching.
export function watchGame(gameId, refresh) {
  let running = false;
  let again = false;
  let stopped = false;

  async function run(reason) {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await refresh(reason);
    } catch (error) {
      console.warn("GeoBarkr refresh failed", error);
    } finally {
      running = false;
      if (again && !stopped) {
        again = false;
        run("again");
      }
    }
  }

  let channel = null;
  (async () => {
    try {
      const client = await getClient();
      const session = await getSession();
      if (session) await client.realtime.setAuth(session.access_token);
      channel = client
        .channel(`game:${gameId}`, { config: { private: true } })
        .on("broadcast", { event: "*" }, (message) => run(message.event))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") run("subscribed");
        });
      if (stopped) client.removeChannel(channel);
    } catch (error) {
      console.warn("GeoBarkr live updates unavailable; re-checking on a timer", error);
    }
  })();

  const timer = setInterval(() => run("poll"), POLL_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") run("visible");
  };
  document.addEventListener("visibilitychange", onVisible);
  queueMicrotask(() => run("start"));

  return {
    refresh: () => run("action"),
    stop() {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) getClient().then((client) => client.removeChannel(channel));
    },
  };
}

// watchGame for a game screen: renders each new game state. If the game can't
// be loaded at all (not yours, or a bad link), stops and calls onFail once.
export function watchGameState(gameId, render, onFail) {
  let loaded = false;
  const watcher = watchGame(gameId, async () => {
    let state;
    try {
      state = await getGameState(gameId);
    } catch (error) {
      if (!loaded) {
        watcher.stop();
        onFail(error);
      }
      return;
    }
    loaded = true;
    await render(state);
  });
  return watcher;
}
