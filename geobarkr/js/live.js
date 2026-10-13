// Keeping a game screen up to date: live events from the backend (Supabase
// Realtime, or this browser in demo mode) plus a re-check on a timer and when
// the screen comes back into view.
import { subscribe, getGameState, isDemo } from "./api.js?v=12";
import { POLL_MS } from "./config.js?v=12";

// Demo bots act on the clock, so demo screens re-check every second.
const INTERVAL = isDemo ? 1000 : POLL_MS;

// Calls refresh() now and after every change. Overlapping calls are merged:
// refresh never runs twice at once, and a change during a refresh triggers one
// more. Returns { refresh, stop }.
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

  const unsubscribe = subscribe(gameId, (event) => run(event));
  const timer = setInterval(() => run("poll"), INTERVAL);
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
      unsubscribe();
    },
  };
}

// watchGame for a game screen: renders each new game state. If the game can't
// be loaded at all (not yours, or a bad link), stops and calls onFail once.
export function watchGameState(gameId, render, onFail) {
  let loaded = false;
  let lastJson = "";
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
    // Skip identical states (demo screens re-check every second).
    const json = JSON.stringify(state);
    if (loaded && json === lastJson) return;
    loaded = true;
    lastJson = json;
    await render(state);
  });
  return watcher;
}
