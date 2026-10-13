// The one place pages talk to the backend. With a Supabase project configured
// (js/config.js) it's the real thing; without one, GeoBarkr runs in demo mode
// in this browser only, with bot players (js/demo.js).
import { isConfigured } from "./supabase.js?v=11";

export const isDemo = !isConfigured();
const backend = await (isDemo ? import("./demo.js?v=11") : import("./remote.js?v=11"));

export const {
  getSession, getProfile, signOut,
  createGame, joinGame, startGame, cancelGame, submitGuess, endRound, nextRound,
  getGameState, getResults, myGames, leaderboard,
  activeMaps, renameMe,
  adminMaps, saveMap, deleteMap, mapLocations, saveLocation, deleteLocation, recentGames,
  subscribe,
} = backend;

export const resultsUrl = (gameId) => `/geobarkr/results/?game=${encodeURIComponent(gameId)}`;

// Which page a game is played on, for me.
export function gamePageUrl(game, { isHost = false, isPlayer = true } = {}) {
  const id = encodeURIComponent(game.id);
  if (game.status === "cancelled") return "/geobarkr/?cancelled=1";
  if (game.status === "complete") return resultsUrl(game.id);
  if (game.type === "local_multiplayer") {
    if (isHost) return `/geobarkr/${game.status === "lobby" ? "lobby" : "host"}/?game=${id}`;
    return game.status === "lobby" ? `/geobarkr/join/?game=${id}` : `/geobarkr/party/?game=${id}`;
  }
  if (game.status === "lobby") return `/geobarkr/lobby/?game=${id}`;
  return isPlayer || isHost ? `/geobarkr/play/?game=${id}` : resultsUrl(game.id);
}
