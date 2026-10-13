// The real backend: Supabase (see geobarkr/supabase/). Every game action is a
// database function that checks who's asking; row-level security does the rest.
import { getClient, getSession as session } from "./supabase.js?v=11";

async function rpc(name, args = {}) {
  const client = await getClient();
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message || "Something went wrong");
  return data;
}

async function table(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export const getSession = session;

export async function getProfile() {
  const current = await session();
  if (!current) return null;
  const client = await getClient();
  return table(client.from("profiles").select("id, display_name, role, avatar_url").eq("id", current.user.id).maybeSingle());
}

export async function signOut() {
  const client = await getClient();
  await client.auth.signOut();
}

export const createGame = (type, mapId) => rpc("create_game", { p_type: type, p_map: mapId });
export const joinGame = (code) => rpc("join_game", { p_code: code });
export const startGame = (gameId) => rpc("start_game", { p_game: gameId });
export const cancelGame = (gameId) => rpc("cancel_game", { p_game: gameId });
export const submitGuess = (gameId, lat, lng) => rpc("submit_guess", { p_game: gameId, p_lat: lat, p_lng: lng });
export const endRound = (gameId) => rpc("end_round", { p_game: gameId });
export const nextRound = (gameId) => rpc("next_round", { p_game: gameId });
export const getGameState = (gameId) => rpc("get_game_state", { p_game: gameId });
export const getResults = (gameId) => rpc("get_results", { p_game: gameId });
export const myGames = () => rpc("my_games");
export const leaderboard = (sort) => rpc("leaderboard", { p_sort: sort, p_limit: 100 });

export async function activeMaps() {
  const client = await getClient();
  return table(client.from("maps").select("id, name").eq("active", true).order("name"));
}

export async function renameMe(name) {
  const current = await session();
  const client = await getClient();
  await table(client.from("profiles").update({ display_name: name }).eq("id", current.user.id));
}

// ---------- Admin (row-level security only lets admins do these) ----------

export async function adminMaps() {
  const client = await getClient();
  return table(client.from("maps").select("id, name, active").order("name"));
}
export async function saveMap(map) {
  const client = await getClient();
  if (map.id) return table(client.from("maps").update({ name: map.name, active: map.active }).eq("id", map.id));
  const [created] = await table(client.from("maps").insert({ name: map.name, active: map.active ?? false }).select("id, name, active"));
  return created;
}
export async function deleteMap(id) {
  const client = await getClient();
  return table(client.from("maps").delete().eq("id", id));
}
export async function mapLocations(mapId) {
  const client = await getClient();
  return table(client.from("locations").select("id, name, round_number, lat, lng, heading, pitch").eq("map_id", mapId).order("round_number"));
}
export async function saveLocation(location) {
  const client = await getClient();
  const { id, ...row } = location;
  if (id) return table(client.from("locations").update(row).eq("id", id));
  return table(client.from("locations").insert(row));
}
export async function deleteLocation(id) {
  const client = await getClient();
  return table(client.from("locations").delete().eq("id", id));
}
export async function recentGames() {
  const client = await getClient();
  const games = await table(client.from("games").select("id, code, type, status, map_name, host_id, created_at").order("created_at", { ascending: false }).limit(50));
  const ids = [...new Set(games.map((game) => game.host_id))];
  const hosts = ids.length ? await table(client.from("profiles").select("id, display_name").in("id", ids)) : [];
  const names = new Map(hosts.map((host) => [host.id, host.display_name]));
  return games.map((game) => ({ ...game, host_name: names.get(game.host_id) || "" }));
}

// ---------- Live updates: the game's private Realtime channel ----------

export function subscribe(gameId, onEvent) {
  let channel = null;
  let stopped = false;
  (async () => {
    try {
      const client = await getClient();
      const current = await session();
      if (current) await client.realtime.setAuth(current.access_token);
      channel = client
        .channel(`game:${gameId}`, { config: { private: true } })
        .on("broadcast", { event: "*" }, (message) => onEvent(message.event))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") onEvent("subscribed");
        });
      if (stopped) client.removeChannel(channel);
    } catch (error) {
      console.warn("GeoBarkr live updates unavailable; re-checking on a timer", error);
    }
  })();
  return () => {
    stopped = true;
    if (channel) getClient().then((client) => client.removeChannel(channel));
  };
}
