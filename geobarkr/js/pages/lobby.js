// The lobby (ServiceNow: "GeoBarkr Lobby players"): who's joined, the room
// code and QR code, and the host's Start Game button. Everyone moves on to the
// game as soon as the host starts it.
import { initPage, $, h, busy, param, qrCode, joinUrl } from "../ui.js";
import { getGameState, startGame, gamePageUrl } from "../api.js";
import { watchGame } from "../live.js";
import { GAME_TYPES, formatDate } from "../geo.js";

await initPage();
const gameId = param("game");
let qrShown = false;
let current = null;

watchGame(gameId, async () => {
  let state;
  try {
    state = await getGameState(gameId);
  } catch (error) {
    $("#loading").textContent = error.message;
    return;
  }
  const { game, players, me } = state;
  current = state;
  if (game.status !== "lobby") {
    location.replace(gamePageUrl(game, { isHost: game.is_host, isPlayer: me.is_player }));
    return;
  }
  if (game.type === "local_multiplayer" && !game.is_host) {
    location.replace(gamePageUrl(game, { isHost: false }));
    return;
  }

  $("#loading").hidden = true;
  $("#lobby").hidden = false;
  $("#players-title").textContent = `Players for ${game.code}`;
  const local = game.type === "local_multiplayer";
  $("#host-note").hidden = !local;
  $("#host-note").textContent = `Hosted by ${game.host_name} on this screen. Players join on their phones.`;

  $("#players").replaceChildren(...(players.length ? players.map((player) => h("li", {},
    h("span", {}, h("span", { class: "gb-name" }, player.name), h("br"),
      h("span", { class: "gb-muted" }, `Joined ${formatDate(player.joined_at)}`)),
    player.is_host ? h("span", { class: "gb-owner" }, "Owner") : null,
  )) : [h("li", { class: "gb-muted" }, "No one has joined yet.")]));

  $("#info-type").textContent = GAME_TYPES[game.type];
  $("#info-map").textContent = game.map_name;
  $("#info-rounds").textContent = game.round_count;
  $("#info-players").textContent = players.length;

  $("#room-code").textContent = game.code;
  if (!qrShown) {
    qrShown = true;
    $("#qr").replaceChildren(await qrCode(joinUrl(game.code)));
  }
  $("#join-help").textContent = local
    ? "Scan the QR code to join on your phone, or go to gabarker.com/geobarkr and enter the code."
    : "Friends can scan the QR code, or go to gabarker.com/geobarkr and enter the code.";

  const canStart = game.is_host && players.length > 1;
  $("#start-button").hidden = !game.is_host;
  $("#start-button").disabled = !canStart;
  $("#waiting-note").textContent = game.is_host
    ? (canStart ? "" : "You can start once at least 2 players have joined.")
    : `Waiting for ${game.host_name} to start the game…`;
});

$("#start-button").addEventListener("click", (event) => {
  busy(event.currentTarget, async () => {
    await startGame(gameId);
    location.replace(gamePageUrl({ ...current.game, status: "in_play" }, { isHost: true, isPlayer: current.me.is_player }));
  });
});
