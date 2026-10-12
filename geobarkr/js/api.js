// One function per game action. They all run in the database (see
// geobarkr/supabase/migrations/002_functions.sql), which checks who's asking.
import { getClient } from "./supabase.js";

async function rpc(name, args = {}) {
  const client = await getClient();
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message || "Something went wrong");
  return data;
}

export const createGame = (type, mapId) => rpc("create_game", { p_type: type, p_map: mapId });
export const joinGame = (code) => rpc("join_game", { p_code: code });
export const startGame = (gameId) => rpc("start_game", { p_game: gameId });
export const submitGuess = (gameId, lat, lng) => rpc("submit_guess", { p_game: gameId, p_lat: lat, p_lng: lng });
export const endRound = (gameId) => rpc("end_round", { p_game: gameId });
export const nextRound = (gameId) => rpc("next_round", { p_game: gameId });
export const getGameState = (gameId) => rpc("get_game_state", { p_game: gameId });
export const getResults = (gameId) => rpc("get_results", { p_game: gameId });
export const myGames = () => rpc("my_games");
export const leaderboard = (sort) => rpc("leaderboard", { p_sort: sort, p_limit: 100 });

// Maps players can start a game on.
export async function activeMaps() {
  const client = await getClient();
  const { data, error } = await client.from("maps").select("id, name").eq("active", true).order("name");
  if (error) throw new Error(error.message);
  return data;
}

export async function renameMe(userId, displayName) {
  const client = await getClient();
  const { error } = await client.from("profiles").update({ display_name: displayName }).eq("id", userId);
  if (error) throw new Error(error.message);
}

// Which page a game is played on, for me.
export function gamePageUrl(game, { isHost = false, isPlayer = true } = {}) {
  const id = encodeURIComponent(game.id);
  if (game.status === "complete" || game.status === "cancelled") return `/geobarkr/results/?game=${id}`;
  if (game.type === "local_multiplayer") {
    if (isHost) return `/geobarkr/${game.status === "lobby" ? "lobby" : "host"}/?game=${id}`;
    return game.status === "lobby" ? `/geobarkr/join/?game=${id}` : `/geobarkr/party/?game=${id}`;
  }
  if (game.status === "lobby") return `/geobarkr/lobby/?game=${id}`;
  return isPlayer || isHost ? `/geobarkr/play/?game=${id}` : `/geobarkr/results/?game=${id}`;
}
