// The lobby (ServiceNow: "GeoBarkr Lobby players"): the room code and QR code,
// who's joined, and the owner's Start button. Everyone moves on to the game
// as soon as the owner starts it.
import { initPage, $, h, busy, param, qrCode, joinUrl, pageError, markNew, toast, showError } from "../ui.js";
import { startGame, gamePageUrl, isDemo } from "../api.js";
import { watchGameState } from "../live.js";
import { drawWorld } from "../worldmap.js";
import { avatar, colourMap } from "../players.js";
import { GAME_TYPES, formatDate } from "../geo.js";

await initPage();
drawWorld($("#band"), { view: { lat: 25, lng: 10, zoom: 0.05 } });
const gameId = param("game");
let qrShown = false;
let current = null;

watchGameState(gameId, async (state) => {
  const { game, players, me } = state;
  current = state;
  if (game.status !== "lobby" || (game.type === "local_multiplayer" && !game.is_host)) {
    location.replace(gamePageUrl(game, { isHost: game.is_host, isPlayer: me.is_player }));
    return;
  }
  $("#loading").hidden = true;
  $("#lobby").hidden = false;

  const local = game.type === "local_multiplayer";
  const code = game.code;
  $("#room-code").textContent = code;
  $("#share-button").hidden = isDemo;
  $("#game-meta").textContent = `${GAME_TYPES[game.type]} · ${game.map_name} · ${game.round_count} rounds`;
  if (!qrShown) {
    qrShown = true;
    $("#qr").replaceWith(await qrCode(joinUrl(code)));
  }
  $("#join-help").textContent = isDemo
    ? "Demo mode: bots join here by themselves. With the real backend, friends scan the QR code or enter the code at gabarker.com/geobarkr."
    : local
      ? "Players scan the QR code, or go to gabarker.com/geobarkr on their phone and enter the code."
      : "Friends scan the QR code, or go to gabarker.com/geobarkr and enter the code.";

  $("#host-note").hidden = !local;
  $("#host-note").textContent = `${game.host_name} is hosting on this screen. Players guess on their phones.`;
  $("#players-title").textContent = `${players.length} player${players.length === 1 ? "" : "s"}`;
  const colours = colourMap(players, me.user_id);
  $("#players").replaceChildren(...(players.length ? players.map((p) => h("div", { class: "gb-line", "data-key": p.user_id },
    avatar(p, colours.get(p.user_id), 34),
    h("div", { class: "grow" }, h("b", {}, p.name), h("span", {}, `Joined ${formatDate(p.joined_at)}`)),
    p.is_host ? h("span", { class: "gb-tag" }, "Owner") : null)) : [h("p", { class: "gb-muted" }, "No one has joined yet.")]));
  markNew($("#players"));

  const canStart = game.is_host && players.length > 1;
  $("#start-button").hidden = !game.is_host;
  $("#start-button").disabled = !canStart;
  $("#waiting-note").textContent = game.is_host
    ? (canStart ? "" : "You can start once at least 2 players have joined.")
    : `Waiting for ${game.host_name} to start the game…`;
}, pageError);

$("#start-button").addEventListener("click", (event) => {
  busy(event.currentTarget, async () => {
    await startGame(gameId);
    location.replace(gamePageUrl({ ...current.game, status: "in_play" }, { isHost: true, isPlayer: current.me.is_player }));
  });
});

// Share the invite: the phone's share sheet where there is one, otherwise copy the link.
$("#share-button").addEventListener("click", async () => {
  const code = current?.game.code;
  if (!code) return;
  const url = joinUrl(code);
  const text = `Join my GeoBarkr game. Room code ${code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "GeoBarkr", text, url });
    } catch (error) {
      if (error.name !== "AbortError") showError(error);
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text}: ${url}`);
    toast("Invite link copied.");
  } catch {
    toast(url);
  }
});
