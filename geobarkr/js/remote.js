// The real backend: Supabase (see geobarkr/supabase/). Every game action is a
// database function that checks who's asking; row-level security does the rest.
import { getClient, getSession as session } from "./supabase.js?v=13";
import { SUPABASE_URL } from "./config.js?v=13";

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

// Maps you can start a game on: admin maps, public player maps and your own.
export const playableMaps = () => rpc("playable_maps");

// ---------- Your maps, profile ----------

export const myStats = () => rpc("my_stats");
export const myMaps = () => rpc("my_maps");
export const getMyMap = (mapId) => rpc("get_my_map", { p_map: mapId });
export const createMyMap = ({ name, description, kind, isPublic }) =>
  rpc("create_my_map", { p_name: name, p_description: description, p_kind: kind, p_public: isPublic });
export const updateMyMap = (mapId, { name, description, isPublic, active }) =>
  rpc("update_my_map", { p_map: mapId, p_name: name, p_description: description, p_public: isPublic, p_active: active });

// Photos the database says nobody uses any more; a failed delete only leaves a file behind.
async function removePhotos(paths) {
  const unused = paths.filter(Boolean);
  if (!unused.length) return;
  const client = await getClient();
  await client.storage.from(PHOTO_BUCKET).remove(unused).catch(() => {});
}

export async function saveMyLocation(mapId, round, location) {
  const result = await rpc("save_my_location", {
    p_map: mapId, p_round: round, p_name: location.name, p_lat: location.lat, p_lng: location.lng,
    p_heading: location.heading ?? 0, p_pitch: location.pitch ?? 0, p_photo_path: location.photo_path ?? null,
  });
  await removePhotos([result?.removed_photo]);
}
export async function deleteMyLocation(mapId, round) {
  const result = await rpc("delete_my_location", { p_map: mapId, p_round: round });
  await removePhotos([result?.removed_photo]);
}
export async function deleteMyMap(mapId) {
  const result = await rpc("delete_my_map", { p_map: mapId });
  await removePhotos(result?.removed_photos || []);
}

// Photos live in the public map-photos bucket, under your user id.
const PHOTO_BUCKET = "map-photos";
export const PHOTO_SIZE = { maxSide: 2048, quality: 0.85 };
export const photoUrl = (path) => (path ? `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${path}` : null);
export async function uploadPhoto(blob) {
  const current = await session();
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(16).slice(2)}`;
  const path = `${current.user.id}/${id.replace(/[^A-Za-z0-9_-]/g, "")}.jpg`;
  const client = await getClient();
  const { error } = await client.storage.from(PHOTO_BUCKET)
    .upload(path, await blob.arrayBuffer(), { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
  if (error) throw new Error(/row-level security|policy/i.test(error.message) ? "You've uploaded a lot of photos. Delete a map to make room" : error.message || "Couldn't upload the photo");
  return path;
}
export const discardPhoto = (path) => removePhotos([path]);

export async function renameMe(name) {
  const current = await session();
  const client = await getClient();
  await table(client.from("profiles").update({ display_name: name }).eq("id", current.user.id));
}

// ---------- Admin (row-level security only lets admins do these) ----------

export async function adminMaps() {
  const client = await getClient();
  const maps = await table(client.from("maps").select("id, name, active, kind, is_public, owner_id, blocked").order("name"));
  const ids = [...new Set(maps.map((map) => map.owner_id).filter(Boolean))];
  const owners = ids.length ? await table(client.from("profiles").select("id, display_name").in("id", ids)) : [];
  const names = new Map(owners.map((owner) => [owner.id, owner.display_name]));
  return maps.map((map) => ({ ...map, owner_name: map.owner_id ? names.get(map.owner_id) || "a player" : null }));
}
export async function saveMap(map) {
  const client = await getClient();
  if (map.id) {
    return table(client.from("maps").update({ name: map.name, active: map.active, ...(map.blocked != null && { blocked: map.blocked }) }).eq("id", map.id));
  }
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
