import { DiscordSDK } from "@discord/embedded-app-sdk";

import robbeLogo from '/robbe.png';
import "./style.css";

const cardBackImage = new URL("../Karten/Back-R.png", import.meta.url).href;

function getCardImagePath(card) {
  if (!card || card.faceDown) {
    return cardBackImage;
  }

  const suitMap = {
    hearts: "H",
    diamonds: "D",
    clubs: "C",
    spades: "S",
  };

  const suit = suitMap[card.suit] ?? "H";
  const rankMap = { A: 1, J: 11, Q: 12, K: 13 };
  const rank = rankMap[card.rank] ?? Number(card.rank ?? 1);
  return new URL(`../Karten/${suit}-${rank}.png`, import.meta.url).href;
}

// Will eventually store the authenticated user's access_token
let auth;
let currentPlayerId;
let currentPlayerName;
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
  currentPlayerName = displayName;
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
  const response = await fetch(`/api/game/${encodeURIComponent(discordSdk.channelId)}?playerId=${encodeURIComponent(currentPlayerId)}&playerName=${encodeURIComponent(currentPlayerName)}`);
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
    cardSets: 3,
    taxes: 50,
    taxesMinimum: 15,
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
  const hand = sortHand(game.players[currentPlayerId] || []);
  const players = Object.entries(game.players);
    const playerNames = game.playerNames || {};
  document.querySelector("#app").innerHTML = `
    <main class="game-screen">
      <button id="settings-button" class="settings-button" type="button">Einstellungen</button>
      <section class="table-area">
        <aside class="board-panel discard-panel"><button id="discard-pile-button" class="card-stage" type="button" aria-label="Ablagestapel anzeigen">${renderCard(game.discardPile.at(-1), 0, false)}</button></aside>
        <section class="draw-panel board-panel"><button id="draw-stack-button" class="draw-stack" type="button" aria-label="Ziehstapel auswählen"><img class="card-back" src="${cardBackImage}" alt="Kartenrückseite" /><span id="draw-count">${game.drawPileCount} Karten</span><output id="draw-amount-value" class="draw-amount is-hidden" aria-live="polite">1</output></button></section>
        <aside class="board-panel object-panel"><h2>Objekte</h2>${settings?.dice ? `<div class="object-manager" data-object="dice"><strong>Würfel</strong><button class="object-toggle" type="button">Anzeigen</button></div>` : ""}${settings?.counter ? `<div class="object-manager" data-object="counter"><strong>Counter</strong><button class="object-toggle" type="button">Anzeigen</button></div>` : ""}<div id="object-dice" class="floating-object dice-object is-hidden"><span>Würfel</span><strong>?</strong><button class="roll-button" type="button">Würfeln</button></div><div id="object-counter" class="floating-object counter-object is-hidden"><span>Counter</span><strong>0</strong><div><button type="button">-</button><button type="button">+</button></div></div></aside>
        <aside class="board-panel players-panel"><div id="player-list">${players.map(([id], index) => `<div class="player-row" data-player-id="${id}"><span>${index + 1}</span><span>${id === currentPlayerId ? "Du" : escapeHtml(playerNames[id] || id)}</span>${id === currentPlayerId ? "" : `<button class="give-player-button is-hidden" type="button" aria-label="Karten an ${escapeHtml(playerNames[id] || id)} geben">Geben</button>`}</div>`).join("")}</div>${renderHistory(game.history || [], playerNames)}</aside>
        <section class="hand-panel"><div class="hand-heading"><button id="previous-hand-page" class="hand-page-button" type="button" aria-label="Vorherige sieben Karten">&#9664;</button><span id="hand-count">${hand.length} Karten</span><button id="next-hand-page" class="hand-page-button" type="button" aria-label="Nächste sieben Karten">&#9654;</button></div><div id="hand-cards" class="hand-cards">${Array.from({ length: 7 }, (_, index) => renderHandCardSlot(hand[index], index)).join("")}</div></section>
        <button id="knock-button" class="knock-button" type="button">KNOCK</button>
      </section>
    </main>`;
  wireGameControls(settings, game, hand);
}

function sortHand(hand) {
  const suitOrder = { spades: 0, diamonds: 1, hearts: 2, clubs: 3 };
  const rankOrder = { J: 11, Q: 12, K: 13, A: 14 };

  return [...hand].sort((firstCard, secondCard) => {
    const rankDifference = (rankOrder[firstCard.rank] ?? Number(firstCard.rank)) - (rankOrder[secondCard.rank] ?? Number(secondCard.rank));
    if (rankDifference !== 0) return rankDifference;
    return (suitOrder[firstCard.suit] ?? 99) - (suitOrder[secondCard.suit] ?? 99);
  });
}

function renderCard(card, index = 0, interactive = true, cardOffset = index) {
  if (!card) return `<div class="empty-card">Leer</div>`;

  const cardTag = interactive ? "button" : "div";
  const cardAttributes = interactive ? ` data-card-id="${card.id}" type="button"` : "";
  const imagePath = getCardImagePath(card);
  const altText = card.faceDown ? "Kartenrückseite" : `${card.rank} ${card.suit}`;

  return `<${cardTag} class="playing-card ${card.faceDown ? "face-down" : ""}"${cardAttributes} style="--card-index:${index};--card-offset:${cardOffset}" aria-label="${altText}"><img src="${imagePath}" alt="${altText}" /></${cardTag}>`;
}

function renderHandCardSlot(card, index) {
  if (!card) return `<button class="playing-card hand-card-slot is-empty" type="button" disabled aria-hidden="true"></button>`;
  const altText = card.faceDown ? "Kartenrückseite" : `${card.rank} ${card.suit}`;
  return `<button class="playing-card hand-card-slot${card.faceDown ? " face-down" : ""}" type="button" data-card-id="${card.id}" aria-label="${altText}"><img src="${getCardImagePath(card)}" alt="${altText}" /></button>`;
}

const suitSymbols = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };

function renderHistory(history, playerNames) {
  return `<div id="game-history" class="game-history">${history.slice().reverse().map((event) => {
    const playerName = playerNames[event.playerId] || event.playerId;
    let message;
    if (event.type === "discard") {
      const cards = formatCardList(event.cards);
      message = `${playerName} laid ${cards}`;
    } else if (event.type === "draw") {
      message = `${playerName} drew ${event.count} ${event.count === 1 ? "card" : "cards"}`;
    } else if (event.type === "knock") {
      message = `${playerName} knocked ${event.count} ${event.count === 1 ? "time" : "times"}`;
    } else {
      message = `${playerName} gave ${event.count} ${event.count === 1 ? "card" : "cards"}`;
    }
    return `<button class="history-entry" type="button" data-history-id="${escapeHtml(event.id)}">${escapeHtml(message)}</button>`;
  }).join("")}</div>`;
}

function formatCardList(cards) {
  const cardNames = cards.map((card) => `${card.rank} ${suitSymbols[card.suit] || ""}`);
  if (cardNames.length < 2) return cardNames.join("");
  return `${cardNames.slice(0, -1).join(", ")} and ${cardNames.at(-1)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

function wireGameControls(settings, game, hand) {
  const cardStates = new Map();
  const channelId = encodeURIComponent(discordSdk.channelId);
  let handPage = 0;
  let selectedPlayerRow;
  let drawStackSelected = false;
  const updateGiveButton = () => {
    document.querySelectorAll(".give-player-button").forEach((button) => button.classList.add("is-hidden"));
    if (selectedPlayerRow && (cardStates.size > 0 || drawStackSelected)) {
      selectedPlayerRow.querySelector(".give-player-button")?.classList.remove("is-hidden");
    }
  };
  document.querySelectorAll(".history-entry").forEach((entry) => entry.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("mao:history-entry-click", { detail: { historyId: entry.dataset.historyId } }));
  }));
  const handCards = document.querySelectorAll("#hand-cards .hand-card-slot");
  const previousHandPage = document.querySelector("#previous-hand-page");
  const nextHandPage = document.querySelector("#next-hand-page");
  const updateHandPage = () => {
    const pageCards = hand.slice(handPage * 7, handPage * 7 + 7);
    handCards.forEach((card, index) => {
      const handCard = pageCards[index];
      card.classList.toggle("is-empty", !handCard);
      card.classList.toggle("face-down", Boolean(handCard?.faceDown));
      card.classList.toggle("selected", Boolean(handCard && cardStates.has(handCard.id)));
      card.disabled = !handCard;
      if (!handCard) {
        card.removeAttribute("data-card-id");
        card.removeAttribute("aria-label");
        card.replaceChildren();
        return;
      }
      const altText = handCard.faceDown ? "Kartenrückseite" : `${handCard.rank} ${handCard.suit}`;
      card.dataset.cardId = handCard.id;
      card.setAttribute("aria-label", altText);
      card.replaceChildren(Object.assign(document.createElement("img"), { src: getCardImagePath(handCard), alt: altText }));
    });
    previousHandPage.disabled = handPage === 0;
    nextHandPage.disabled = (handPage + 1) * 7 >= hand.length;
  };
  previousHandPage.addEventListener("click", () => { handPage -= 1; updateHandPage(); });
  nextHandPage.addEventListener("click", () => { handPage += 1; updateHandPage(); });
  handCards.forEach((card) => card.addEventListener("click", () => {
    const cardId = card.dataset.cardId;
    const state = cardStates.get(cardId) || "none";
    if (state === "none") {
      cardStates.set(cardId, "selected"); card.classList.add("selected");
    } else if (state === "selected") {
      if (settings.faceDownCardsPlayable) {
        cardStates.set(cardId, "face-down"); card.classList.add("face-down");
      } else {
        cardStates.delete(cardId); card.classList.remove("selected");
      }
    } else {
      cardStates.delete(cardId); card.classList.remove("selected", "face-down");
    }
    updateHandPage();
    updateGiveButton();
  }));
  updateHandPage();
  const discardPileButton = document.querySelector("#discard-pile-button");
  const drawStackButton = document.querySelector("#draw-stack-button");
  const drawAmount = document.querySelector("#draw-amount-value");
  let discardDeselectTimer;
  let discardIndex = game.discardPile.length - 1;
  const updateDiscardCard = () => {
    const card = game.discardPile[discardIndex];
    discardPileButton.innerHTML = renderCard(card, 0, false);
    discardPileButton.setAttribute("aria-label", card ? `Ablagestapel: ${card.rank} ${card.suit}` : "Ablagestapel leer");
  };
  const discard = async () => {
    const cardIds = [...cardStates.keys()];
    const faceDownCardIds = [...cardStates]
      .filter(([, state]) => state === "face-down")
      .map(([id]) => id);
    if (cardIds.length) {
      await gameRequest(`/api/game/${channelId}/discard`, {
        playerId: currentPlayerId,
        cardIds,
        faceDownCardIds,
      });
      await refreshGame(settings);
    }
  };
  discardPileButton.addEventListener("click", () => {
    if (cardStates.size > 0) {
      discard();
      return;
    }
    const isSelected = discardPileButton.classList.toggle("selected");
    if (isSelected) {
      scheduleDiscardDeselect();
    } else {
      clearTimeout(discardDeselectTimer);
    }
  });
  discardPileButton.addEventListener("wheel", (event) => {
    if (!discardPileButton.classList.contains("selected") || game.discardPile.length < 2) return;
    event.preventDefault();
    discardIndex = Math.max(0, Math.min(game.discardPile.length - 1, discardIndex + (event.deltaY < 0 ? 1 : -1)));
    updateDiscardCard();
    scheduleDiscardDeselect();
  }, { passive: false });
  const scheduleDiscardDeselect = () => {
    clearTimeout(discardDeselectTimer);
    if (!discardPileButton.classList.contains("selected")) return;
    discardDeselectTimer = setTimeout(() => {
      discardPileButton.classList.remove("selected");
    }, 5000);
  };
  const deselectDrawStack = () => {
    drawStackSelected = false;
    drawStackButton.classList.remove("selected");
    drawAmount.classList.add("is-hidden");
  };
  document.addEventListener("click", (event) => {
    if (!discardPileButton.contains(event.target)) {
      discardPileButton.classList.remove("selected");
      clearTimeout(discardDeselectTimer);
    }
    if (!drawStackButton.contains(event.target)) deselectDrawStack();
  });
  drawStackButton.addEventListener("click", async () => {
    if (!drawStackSelected) {
      drawStackSelected = true;
      drawStackButton.classList.add("selected");
      drawAmount.classList.remove("is-hidden");
      updateGiveButton();
      return;
    }
    await gameRequest(`/api/game/${channelId}/draw`, { playerId: currentPlayerId, count: Number(drawAmount.value) });
    await refreshGame(settings);
  });
  drawStackButton.addEventListener("wheel", (event) => {
    if (!drawStackSelected) return;
    event.preventDefault();
    drawAmount.value = Math.max(0, Math.min(20, Number(drawAmount.value) + (event.deltaY < 0 ? 1 : -1)));
    scheduleDiscardDeselect();
  }, { passive: false });
  const giveToPlayer = async (toPlayerId) => {
    const handCardIds = [...cardStates.keys()];
    const drawCount = drawStackSelected ? Number(drawAmount.value) : 0;
    if (!handCardIds.length && drawCount === 0) return;

    if (handCardIds.length) {
      await gameRequest(`/api/game/${channelId}/give`, {
        fromPlayerId: currentPlayerId,
        toPlayerId,
        cardIds: handCardIds,
      });
    }
    if (drawCount) {
      await gameRequest(`/api/game/${channelId}/give-from-draw`, {
        toPlayerId,
        count: drawCount,
      });
    }
    await refreshGame(settings);
  };
  document.querySelectorAll(".player-row").forEach((row) => row.addEventListener("click", () => {
    document.querySelectorAll(".player-row").forEach((item) => {
      item.classList.remove("target");
      item.querySelector(".give-player-button")?.classList.add("is-hidden");
    });
    selectedPlayerRow = row;
    row.classList.add("target");
    updateGiveButton();
  }));
  document.querySelectorAll(".give-player-button").forEach((button) => button.addEventListener("click", async (event) => {
    event.stopPropagation();
    const row = button.closest(".player-row");
    await giveToPlayer(row.dataset.playerId);
  }));
  document.querySelector("#settings-button").addEventListener("click", () => { renderSettingsScreen(settings); document.querySelector("#settings-form").dataset.mode = "update"; });
  document.querySelector("#knock-button").addEventListener("click", async () => {
    await gameRequest(`/api/game/${channelId}/knock`, { playerId: currentPlayerId });
    await refreshGame(settings);
  });
  document.querySelectorAll(".object-toggle").forEach((button) => button.addEventListener("click", () => { const object = button.closest(".object-manager").dataset.object; document.querySelector(`#object-${object}`).classList.toggle("is-hidden"); button.textContent = button.textContent === "Anzeigen" ? "Verstecken" : "Anzeigen"; }));
  document.querySelector(".roll-button")?.addEventListener("click", (event) => { event.currentTarget.previousElementSibling.textContent = String(Math.floor(Math.random() * 6) + 1); }); document.querySelectorAll(".floating-object").forEach(makeDraggable);
}

async function gameRequest(url, body) { const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!response.ok) throw new Error((await response.json()).error || "Spielaktion fehlgeschlagen"); return response.json(); }
async function refreshGame(settings) { await loadGame(settings); }
function startPlayerHeartbeat() {
  const playerUrl = `/api/game/${encodeURIComponent(discordSdk.channelId)}/players/${encodeURIComponent(currentPlayerId)}`;
  const heartbeat = () => fetch(`${playerUrl}/heartbeat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerName: currentPlayerName }) }).catch(() => {});
  heartbeat();
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(heartbeat, 5000);
  window.addEventListener("beforeunload", () => {
    clearInterval(heartbeatTimer);
    fetch(playerUrl, { method: "DELETE", keepalive: true }).catch(() => {});
  }, { once: true });
}
function makeDraggable(element) { let startX; let startY; let originX; let originY; element.addEventListener("pointerdown", (event) => { if (event.target.tagName === "BUTTON") return; element.setPointerCapture(event.pointerId); startX = event.clientX; startY = event.clientY; originX = element.offsetLeft; originY = element.offsetTop; }); element.addEventListener("pointermove", (event) => { if (element.hasPointerCapture(event.pointerId)) { element.style.left = `${originX + event.clientX - startX}px`; element.style.top = `${originY + event.clientY - startY}px`; } }); }