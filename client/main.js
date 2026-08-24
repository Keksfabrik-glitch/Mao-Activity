import { DiscordSDK } from "@discord/embedded-app-sdk";

import robbeLogo from '/robbe.png';
import herzSymbol from '../Bilder/Herz.png';
import karoSymbol from '../Bilder/Karo.png';
import kreuzSymbol from '../Bilder/Kreuz.png';
import pikSymbol from '../Bilder/Pik.png';
import rueckseiteBild from '../Bilder/Rückseite.png';
import "./style.css";

// Will eventually store the authenticated user's access_token
let auth;
let currentPlayerId;
let heartbeatTimer;

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

setupDiscordSdk().then(() => {
  console.log("Discord SDK is authenticated");

  return startActivity();
}).catch((error) => {
  console.error("Discord SDK setup failed", error);
});

async function setupDiscordSdk() {
  await discordSdk.ready();
  console.log("Discord SDK is ready");

  // Authorize with Discord Client
  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: [
      "identify",
      "guilds",
      "applications.commands"
    ],
  });

  // Retrieve an access_token from your activity's server
  const response = await fetch("/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
    }),
  });
  const { access_token } = await response.json();

  // Authenticate with Discord client (using the access_token)
  auth = await discordSdk.commands.authenticate({
    access_token,
  });

  if (auth == null) {
    throw new Error("Authenticate command failed");
  }
}

async function appendVoiceChannelName() {
  const channelName = document.querySelector("#channel-name");
  let activityChannelName = "Unbekannter Channel";

  // Requesting the channel in DMs requires the dm_channels.read scope.
  if (discordSdk.channelId != null && discordSdk.guildId != null) {
    const channel = await discordSdk.commands.getChannel({
      channel_id: discordSdk.channelId,
    });

    if (channel.name != null) {
      activityChannelName = channel.name;
    }
  }

  channelName.textContent = `Channel: ${activityChannelName}`;
}

async function appendPlayerProfile() {
  const playerName = document.querySelector("#player-name");
  const playerAvatar = document.querySelector("#player-avatar");

  const player = await fetch("https://discord.com/api/v10/users/@me", {
    headers: {
      Authorization: `Bearer ${auth.access_token}`,
      "Content-Type": "application/json",
    },
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Discord user request failed: ${response.status}`);
    }
    return response.json();
  });

  const displayName = player.global_name || player.username;
  currentPlayerId = player.id;
  const avatarUrl = player.avatar
    ? `https://cdn.discordapp.com/avatars/${player.id}/${player.avatar}.webp?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(player.id) >> 22n) % 6}.png`;

  playerName.textContent = displayName;
  playerAvatar.src = avatarUrl;
  playerAvatar.alt = `${displayName} Avatar`;
}

async function startActivity() {
  renderLoadingScreen();
  await appendVoiceChannelName();
  await appendPlayerProfile();

  if (discordSdk.channelId == null) {
    renderGameScreen(null);
    return;
  }

  startPlayerHeartbeat();

  const settingsUrl = `/api/settings/${encodeURIComponent(discordSdk.channelId)}`;
  const response = await fetch(settingsUrl);
  const { settings } = await response.json();

  if (settings == null) {
    renderSettingsScreen();
    return;
  }

  await loadGame(settings);
}

async function loadGame(settings) {
  const response = await fetch(`/api/game/${encodeURIComponent(discordSdk.channelId)}?playerId=${encodeURIComponent(currentPlayerId)}`);
  if (!response.ok) throw new Error("Spiel konnte nicht geladen werden.");
  const { game } = await response.json();
  window.currentGame = game;
  renderGameScreen(settings);
}

function renderLoadingScreen() {
  document.querySelector("#app").innerHTML = `
    <main class="activity-shell">
      <img src="${robbeLogo}" class="logo" alt="Mao" />
      <p>Spiel wird geladen ...</p>
      <p id="channel-name" class="is-hidden"></p>
      <div class="player-profile is-hidden">
        <img id="player-avatar" class="player-avatar" alt="Spieleravatar" />
        <span id="player-name"></span>
      </div>
    </main>
  `;
}

function renderSettingsScreen(currentSettings = null) {
  const defaults = {
    cardSets: 2,
    taxes: 50,
    taxesMinimum: 15,
    turnLocking: true,
    dice: true,
    customDice: true,
    counter: true,
    faceDownCardsPlayable: true,
    ...currentSettings,
  };

  document.querySelector("#app").innerHTML = `
    <main class="activity-shell settings-screen">
      <section class="settings-panel">
        <p class="eyebrow">Mao</p>
        <h1>Spieleinstellungen</h1>
        <p class="settings-intro">Die erste Person legt die Regeln für diesen Voice-Channel fest.</p>
        <form id="settings-form">
          <label for="card-sets">Kartensets: <output id="card-sets-value">${defaults.cardSets}</output></label>
          <input id="card-sets" name="cardSets" type="range" min="2" max="5" value="${defaults.cardSets}" />

          <label for="taxes">Taxes: <output id="taxes-value">${defaults.taxes}%</output></label>
          <input id="taxes" name="taxes" type="range" min="0" max="100" value="${defaults.taxes}" />

          <label for="taxes-minimum">Taxes-Minimum: <output id="taxes-minimum-value">${defaults.taxesMinimum}</output></label>
          <input id="taxes-minimum" name="taxesMinimum" type="number" min="0" max="260" value="${defaults.taxesMinimum}" ${defaults.taxes === 0 ? "disabled" : ""} />

          <div class="settings-options">
            ${renderToggle("turn-locking", "Zug-Locking", defaults.turnLocking)}
            ${renderToggle("dice", "Würfel", defaults.dice)}
            ${renderToggle("custom-dice", "Custom Würfel", defaults.customDice)}
            ${renderToggle("counter", "Counter", defaults.counter)}
            ${renderToggle("face-down-cards-playable", "Karten umgedreht spielbar", defaults.faceDownCardsPlayable)}
          </div>
          <p id="settings-error" class="form-error" role="alert"></p>
          <button type="submit">Einstellungen speichern</button>
        </form>
      </section>
    </main>
  `;

  const cardSets = document.querySelector("#card-sets");
  const taxes = document.querySelector("#taxes");
  const taxesMinimum = document.querySelector("#taxes-minimum");
  const dice = document.querySelector("#dice");
  const customDice = document.querySelector("#custom-dice");
  cardSets.addEventListener("input", () => {
    document.querySelector("#card-sets-value").value = cardSets.value;
  });
  taxes.addEventListener("input", () => {
    document.querySelector("#taxes-value").value = `${taxes.value}%`;
    taxesMinimum.disabled = Number(taxes.value) === 0;
  });
  customDice.disabled = !dice.checked;
  dice.addEventListener("change", () => {
    customDice.disabled = !dice.checked;
    if (customDice.disabled) {
      customDice.checked = false;
    }
  });
  document.querySelector("#settings-form").addEventListener("submit", saveSettings);
}

function renderToggle(id, label, checked) {
  return `
    <label class="toggle-option">
      <span>${label}</span>
      <input id="${id}" name="${id}" type="checkbox" ${checked ? "checked" : ""} />
      <span class="toggle" aria-hidden="true"></span>
    </label>
  `;
}

async function saveSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const settings = {
    cardSets: Number(form.get("cardSets")),
    taxes: Number(form.get("taxes")),
    taxesMinimum: Number(form.get("taxesMinimum")),
    turnLocking: form.has("turn-locking"),
    dice: form.has("dice"),
    customDice: form.has("custom-dice"),
    counter: form.has("counter"),
    faceDownCardsPlayable: form.has("face-down-cards-playable"),
  };

  const isUpdate = event.currentTarget.dataset.mode === "update";
  const settingsUrl = `/api/settings/${encodeURIComponent(discordSdk.channelId)}`;
  const response = await fetch(settingsUrl, {
    method: isUpdate ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });

  if (response.status === 409) {
    const { settings: savedSettings } = await response.json();
    renderGameScreen(savedSettings);
    return;
  }

  if (!response.ok) {
    document.querySelector("#settings-error").textContent = "Einstellungen konnten nicht gespeichert werden.";
    return;
  }

  renderGameScreen(settings);
}

function renderGameScreen(settings) {
  const game = window.currentGame || { drawPileCount: 0, discardPile: [], players: { [currentPlayerId]: [] } };
  const hand = game.players[currentPlayerId] || [];
  const players = Object.entries(game.players);
  const topCard = game.discardPile[game.discardPile.length - 1];
  document.querySelector("#app").innerHTML = `
    <main class="game-screen">
      <button id="settings-button" class="settings-button" type="button">Einstellungen</button>
      <section class="table-area">
        <aside class="board-panel discard-panel"><p class="panel-hint">Ausgewählte Karten ablegen</p><div class="card-stage">${renderCard(topCard)}</div><button id="discard-button" type="button">Aufrecht ablegen</button>${settings?.faceDownCardsPlayable ? `<button id="discard-face-down-button" class="subtle-button" type="button">Verdeckt ablegen</button>` : ""}<button id="history-button" class="subtle-button" type="button">Verlauf anzeigen</button></aside>
        <section class="draw-panel board-panel"><div class="draw-stack"><img class="card-back" src="${rueckseiteBild}" alt="Kartenrückseite" /><span id="draw-count">${game.drawPileCount} Karten</span></div><label for="draw-amount">Anzahl <output id="draw-amount-value">1</output></label><input id="draw-amount" type="range" min="1" max="20" value="1" /><button id="draw-button" type="button">Karten ziehen</button></section>
        <aside class="board-panel object-panel"><h2>Objekte</h2>${settings?.dice ? `<div class="object-manager" data-object="dice"><strong>Würfel</strong><button class="object-toggle" type="button">Anzeigen</button></div>` : ""}${settings?.counter ? `<div class="object-manager" data-object="counter"><strong>Counter</strong><button class="object-toggle" type="button">Anzeigen</button></div>` : ""}<div id="object-dice" class="floating-object dice-object is-hidden"><span>Würfel</span><strong>?</strong><button class="roll-button" type="button">Würfeln</button></div><div id="object-counter" class="floating-object counter-object is-hidden"><span>Counter</span><strong>0</strong><div><button type="button">-</button><button type="button">+</button></div></div></aside>
        <aside class="board-panel players-panel"><h2>Spieler</h2><div id="player-list">${players.map(([id], index) => `<button class="player-row" data-player-id="${id}" type="button"><span>${index + 1}</span>${id === currentPlayerId ? "Du" : id}</button>`).join("")}</div><div class="give-controls"><label for="give-amount">Karten geben</label><input id="give-amount" type="number" min="1" max="20" value="1" /><button id="give-button" type="button">Vom Stapel geben</button><button id="give-selected-button" class="subtle-button" type="button">Auswahl geben</button></div></aside>
        <section class="hand-panel"><div class="hand-heading"><span>${hand.length} Karten</span></div><div id="hand-cards" class="hand-cards">${hand.map((card, index) => renderCard(card, index)).join("") || `<p class="empty-state">Noch keine Karten auf der Hand</p>`}</div><div class="hand-actions"><button id="sort-button" type="button">Sortieren</button><button id="clear-selection" class="subtle-button" type="button">Auswahl aufheben</button></div></section>
        <button id="knock-button" class="knock-button" type="button">KNOCK</button>
      </section><div id="history-modal" class="history-modal is-hidden"><div class="history-content"><button id="close-history" type="button">Schließen</button><h2>Ablageverlauf</h2>${[...game.discardPile].reverse().map((card) => renderCard(card)).join("")}</div></div>
    </main>`;
  wireGameControls(settings, game);
}

function renderCard(card, index = 0) {
  if (!card) return `<div class="empty-card">Leer</div>`;
  const symbols = { hearts: herzSymbol, diamonds: karoSymbol, clubs: kreuzSymbol, spades: pikSymbol };
  return `<button class="playing-card ${card.faceDown ? "face-down" : ""}" data-card-id="${card.id}" style="--card-index:${index}" type="button">${card.faceDown ? `<img src="${rueckseiteBild}" alt="Kartenrückseite" />` : `<span>${card.rank}</span><img src="${symbols[card.suit]}" alt="${card.suit}" />`}</button>`;
}

function wireGameControls(settings, game) {
  const selected = new Set();
  const cardStates = new Map();
  const channelId = encodeURIComponent(discordSdk.channelId);
  document.querySelectorAll("#hand-cards .playing-card").forEach((card) => card.addEventListener("click", () => {
    const cardId = card.dataset.cardId;
    const state = cardStates.get(cardId) || "none";
    if (state === "none") {
      cardStates.set(cardId, "selected"); selected.add(cardId); card.classList.add("selected");
    } else if (state === "selected") {
      if (settings.faceDownCardsPlayable) {
        cardStates.set(cardId, "face-down"); card.classList.add("face-down");
      } else {
        cardStates.delete(cardId); selected.delete(cardId); card.classList.remove("selected");
      }
    } else {
      cardStates.delete(cardId); selected.delete(cardId); card.classList.remove("selected", "face-down");
    }
  }));
  document.querySelector("#clear-selection").addEventListener("click", () => { selected.clear(); cardStates.clear(); document.querySelectorAll("#hand-cards .playing-card").forEach((card) => card.classList.remove("selected", "face-down")); });
  const discard = async (faceDown) => { const cardIds = [...cardStates].filter(([, state]) => state === (faceDown ? "face-down" : "selected")).map(([id]) => id); if (cardIds.length) { await gameRequest(`/api/game/${channelId}/discard`, { playerId: currentPlayerId, cardIds, faceDown }); await refreshGame(settings); } };
  document.querySelector("#discard-button").addEventListener("click", () => discard(false));
  document.querySelector("#discard-face-down-button")?.addEventListener("click", () => discard(true));
  const drawAmount = document.querySelector("#draw-amount"); drawAmount.addEventListener("input", () => { document.querySelector("#draw-amount-value").value = drawAmount.value; });
  drawAmount.addEventListener("wheel", (event) => { event.preventDefault(); drawAmount.value = Math.max(1, Math.min(20, Number(drawAmount.value) + (event.deltaY < 0 ? 1 : -1))); drawAmount.dispatchEvent(new Event("input")); }, { passive: false });
  document.querySelector("#draw-button").addEventListener("click", async () => { await gameRequest(`/api/game/${channelId}/draw`, { playerId: currentPlayerId, count: Number(drawAmount.value) }); await refreshGame(settings); });
  let targetPlayerId; document.querySelectorAll(".player-row").forEach((row) => row.addEventListener("click", () => { targetPlayerId = row.dataset.playerId; document.querySelectorAll(".player-row").forEach((item) => item.classList.remove("target")); row.classList.add("target"); }));
  document.querySelector("#give-button").addEventListener("click", async () => { if (targetPlayerId) { await gameRequest(`/api/game/${channelId}/give-from-draw`, { toPlayerId: targetPlayerId, count: Number(document.querySelector("#give-amount").value) }); await refreshGame(settings); } });
  document.querySelector("#give-selected-button").addEventListener("click", async () => { if (targetPlayerId && selected.size) { await gameRequest(`/api/game/${channelId}/give`, { fromPlayerId: currentPlayerId, toPlayerId: targetPlayerId, cardIds: [...selected] }); await refreshGame(settings); } });
  document.querySelector("#sort-button").addEventListener("click", () => { document.querySelectorAll(".playing-card").forEach((card, index) => card.style.setProperty("--card-index", index)); });
  document.querySelector("#history-button").addEventListener("click", () => document.querySelector("#history-modal").classList.remove("is-hidden")); document.querySelector("#close-history").addEventListener("click", () => document.querySelector("#history-modal").classList.add("is-hidden"));
  document.querySelector("#settings-button").addEventListener("click", () => { renderSettingsScreen(settings); document.querySelector("#settings-form").dataset.mode = "update"; });
  document.querySelectorAll(".object-toggle").forEach((button) => button.addEventListener("click", () => { const object = button.closest(".object-manager").dataset.object; document.querySelector(`#object-${object}`).classList.toggle("is-hidden"); button.textContent = button.textContent === "Anzeigen" ? "Verstecken" : "Anzeigen"; }));
  document.querySelector(".roll-button")?.addEventListener("click", (event) => { event.currentTarget.previousElementSibling.textContent = String(Math.floor(Math.random() * 6) + 1); }); document.querySelectorAll(".floating-object").forEach(makeDraggable);
}

async function gameRequest(url, body) { const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!response.ok) throw new Error((await response.json()).error || "Spielaktion fehlgeschlagen"); return response.json(); }
async function refreshGame(settings) { await loadGame(settings); }
function startPlayerHeartbeat() {
  const playerUrl = `/api/game/${encodeURIComponent(discordSdk.channelId)}/players/${encodeURIComponent(currentPlayerId)}`;
  const heartbeat = () => fetch(`${playerUrl}/heartbeat`, { method: "POST" }).catch(() => {});
  heartbeat();
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(heartbeat, 5000);
  window.addEventListener("beforeunload", () => {
    clearInterval(heartbeatTimer);
    fetch(playerUrl, { method: "DELETE", keepalive: true }).catch(() => {});
  }, { once: true });
}
function makeDraggable(element) { let startX; let startY; let originX; let originY; element.addEventListener("pointerdown", (event) => { if (event.target.tagName === "BUTTON") return; element.setPointerCapture(event.pointerId); startX = event.clientX; startY = event.clientY; originX = element.offsetLeft; originY = element.offsetTop; }); element.addEventListener("pointermove", (event) => { if (element.hasPointerCapture(event.pointerId)) { element.style.left = `${originX + event.clientX - startX}px`; element.style.top = `${originY + event.clientY - startY}px`; } }); }