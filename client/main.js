import { DiscordSDK } from "@discord/embedded-app-sdk";

import robbeLogo from '/robbe.png';
import "./style.css";

const cardBackImage = new URL("../Karten/Back-R.png", import.meta.url).href;
const faceDownCardImages = import.meta.glob("../Karten2/*.png", { eager: true, import: "default", query: "?url" });

function getCardImagePath(card, useFaceDownTexture = false) {
  if (!card) {
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
  if (card.faceDown && useFaceDownTexture) {
    return faceDownCardImages[`../Karten2/${suit}-${rank}-2.png`];
  }
  if (card.faceDown) return cardBackImage;
  return new URL(`../Karten/${suit}-${rank}.png`, import.meta.url).href;
}

// Will eventually store the authenticated user's access_token
let auth;
let currentPlayerId;
let currentPlayerName;
let heartbeatTimer;
let pollTimer;
const boardItemPositions = new Map();

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
  let activityChannelName = "Unknown channel";

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
  if (!response.ok) throw new Error("Could not load game.");
  const { game } = await response.json();
  window.currentGame = game;
  renderGameScreen(settings);
}
function startGamePolling(settings) {
  clearInterval(pollTimer);
  const channelId = encodeURIComponent(discordSdk.channelId);
  pollTimer = setInterval(async () => {
    try {
      const response = await fetch(`/api/game/${channelId}`);
      if (!response.ok) return;
      const { game } = await response.json();
      if (JSON.stringify(game) !== JSON.stringify(window.currentGame)) {
        window.currentGame = game;
        renderGameScreen(settings);
      }
    } catch (error) {
      // Ignore polling network errors; the next attempt follows automatically.
    }
  }, 2000);
}
function renderLoadingScreen() {
  document.querySelector("#app").innerHTML = `
    <main class="activity-shell">
      <img src="${robbeLogo}" class="logo" alt="Mao" />
      <p>Loading game...</p>
      <p id="channel-name" class="is-hidden"></p>
      <div class="player-profile is-hidden">
        <img id="player-avatar" class="player-avatar" alt="Player avatar" />
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
    faceDownCardsPlayable: true,
    ...currentSettings,
  };

  document.querySelector("#app").innerHTML = `
    <main class="activity-shell settings-screen">
      <section class="settings-panel">
        <p class="eyebrow">Mao</p>
        <h1>Game settings</h1>
        <p class="settings-intro">The first player sets the rules for this voice channel.</p>
        <form id="settings-form">
          <label for="card-sets">Card decks: <output id="card-sets-value">${defaults.cardSets}</output></label>
          <input id="card-sets" name="cardSets" type="range" min="2" max="5" value="${defaults.cardSets}" />

          <label for="taxes">Taxes: <output id="taxes-value">${defaults.taxes}%</output></label>
          <input id="taxes" name="taxes" type="range" min="0" max="100" value="${defaults.taxes}" />

          <label for="taxes-minimum">Minimum tax: <output id="taxes-minimum-value">${defaults.taxesMinimum}</output></label>
          <input id="taxes-minimum" name="taxesMinimum" type="number" min="0" max="260" value="${defaults.taxesMinimum}" ${defaults.taxes === 0 ? "disabled" : ""} />

          <div class="settings-options">
            ${renderToggle("dice", "Dice", defaults.dice)}
            ${renderToggle("custom-dice", "Custom dice", defaults.customDice)}
            ${renderToggle("face-down-cards-playable", "Allow face-down cards", defaults.faceDownCardsPlayable)}
          </div>
          <p id="settings-error" class="form-error" role="alert"></p>
          <button type="submit">Save settings</button>
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
    document.querySelector("#settings-error").textContent = "Could not save settings.";
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
      <button id="settings-button" class="settings-button" type="button">Settings</button>
      <section class="table-area">
        <aside class="board-panel discard-panel"><button id="discard-pile-button" class="card-stage" type="button" aria-label="Show discard pile">${renderCard(game.discardPile.at(-1), 0, false)}</button></aside>
        <section class="draw-panel board-panel"><button id="draw-stack-button" class="draw-stack" type="button" aria-label="Select draw pile"><img class="card-back" src="${cardBackImage}" alt="Card back" /><span id="draw-count">${game.drawPileCount} ${game.drawPileCount === 1 ? "card" : "cards"}</span><output id="draw-amount-value" class="draw-amount is-hidden" aria-live="polite">1</output></button></section>
        ${settings?.dice ? `<aside class="board-panel dice-panel"><button id="dice-toggle" class="dice-heading" type="button"><strong>Dice</strong></button><div id="dice-list" class="dice-list is-collapsed">${(game.dice || []).map((die) => `<button class="die-list-entry" type="button" data-die-id="${escapeHtml(die.id)}">${escapeHtml(die.name)}</button>`).join("")}</div><button id="dice-add-button" class="dice-add-button is-collapsed" type="button" aria-label="Add die">+</button></aside>${(game.dice || []).map((die, index) => `<button class="board-die" type="button" data-die-id="${escapeHtml(die.id)}" style="--die-index:${index}" title="${escapeHtml(die.name)}">${escapeHtml(die.name)}</button>`).join("")}<dialog id="dice-dialog" class="dice-dialog"><form id="dice-form"><button id="dice-dialog-close" class="dialog-close" type="button" aria-label="Close dialog">x</button><h2>Create a die</h2><label for="dice-name">Name</label><input id="dice-name" name="name" required maxlength="40" placeholder="e.g. D20" /><label for="dice-type">Type</label><select id="dice-type" name="type"><option value="coin">Coin</option><option value="d4">D4</option><option value="d6">D6</option><option value="d8">D8</option><option value="d10">D10</option><option value="d12">D12</option><option value="d20">D20</option>${settings.customDice ? '<option value="custom">Custom die</option>' : ""}</select><div id="custom-dice-fields" class="is-hidden"><label for="dice-sides">Sides, comma-separated</label><textarea id="dice-sides" name="sides" rows="4" placeholder="Yes,No,Maybe"></textarea></div><p id="dice-error" class="form-error" role="alert"></p><button class="confirm-button" type="submit">Confirm</button></form></dialog>` : ""}
        ${settings ? `${renderCounterManager(game.counters || [])}${(game.counters || []).map(renderCounterWidget).join("")}<dialog id="counter-dialog" class="dice-dialog"><form id="counter-form"><button id="counter-dialog-close" class="dialog-close" type="button" aria-label="Close dialog">x</button><h2>Create a counter</h2><label for="counter-name">Name</label><input id="counter-name" name="name" required maxlength="40" placeholder="e.g. Score" /><label for="counter-increment">Increase by</label><input id="counter-increment" name="increment" type="number" min="1" max="1000000" required value="1" /><label for="counter-decrement">Decrease by</label><input id="counter-decrement" name="decrement" type="number" min="1" max="1000000" required value="1" /><label for="counter-minimum">Minimum (optional)</label><input id="counter-minimum" name="minimum" type="number" min="-9007199254740991" max="9007199254740991" /><label for="counter-maximum">Maximum (optional)</label><input id="counter-maximum" name="maximum" type="number" min="-9007199254740991" max="9007199254740991" />${renderToggle("counter-show-limits", "Show limits", true)}<p class="settings-hint">Reset returns to the minimum, or to 0 if no minimum is set.</p><p id="counter-create-error" class="form-error" role="alert"></p><button class="confirm-button" type="submit">Create counter</button></form></dialog>` : ""}
        <aside class="board-panel players-panel"><div id="player-list">${players.map(([id], index) => `<div class="player-row" data-player-id="${id}"><span>${index + 1}</span><span class="player-name">${id === currentPlayerId ? "You" : escapeHtml(playerNames[id] || id)}<small class="player-card-count">${(game.players[id] || []).length}</small></span>${id === currentPlayerId ? "" : `<button class="give-player-button is-hidden" type="button" aria-label="Give cards to ${escapeHtml(playerNames[id] || id)}">Give</button>`}</div>`).join("")}</div>${renderHistory(game.history || [], playerNames)}</aside>
        <section class="hand-panel"><div class="hand-heading"><button id="previous-hand-page" class="hand-page-button" type="button" aria-label="Previous seven cards">&#9664;</button><span id="hand-count">${hand.length} ${hand.length === 1 ? "card" : "cards"}</span><button id="next-hand-page" class="hand-page-button" type="button" aria-label="Next seven cards">&#9654;</button></div><div id="hand-cards" class="hand-cards">${Array.from({ length: 7 }, (_, index) => renderHandCardSlot(hand[index], index)).join("")}</div></section>
        <button id="knock-button" class="knock-button" type="button">KNOCK</button>
      </section>
    </main>`;
  wireGameControls(settings, game, hand);
  if (discordSdk.channelId != null) {
    startGamePolling(settings);
  }
}

function renderCounterManager(counters) {
  return `
    <aside class="counters-panel">
      <div class="counters-heading">
        <button id="counters-toggle" type="button" aria-expanded="false">Counters (${counters.length})</button>
        <button id="counter-add-button" type="button" aria-label="Add counter">+</button>
      </div>
      <div id="counter-list" class="counter-list is-collapsed">${counters.map((counter) => `<span>${escapeHtml(counter.name)}</span>`).join("")}</div>
    </aside>
  `;
}

function renderCounterWidget(counter, index) {
  const { id, name, value, increment, decrement, minimum, maximum, showLimits } = counter;
  const resetValue = Math.min(maximum ?? Number.MAX_SAFE_INTEGER, Math.max(minimum ?? Number.MIN_SAFE_INTEGER, minimum ?? 0));
  const limits = showLimits && (minimum != null || maximum != null)
    ? `<p class="counter-limits">${minimum == null ? "−∞" : `min ${escapeHtml(minimum)}`} · ${maximum == null ? "+∞" : `max ${escapeHtml(maximum)}`}</p>`
    : "";

  return `
    <section class="board-counter" data-counter-id="${escapeHtml(id)}" style="--counter-index:${index}" aria-label="Counter ${escapeHtml(name)}">
      <h2>${escapeHtml(name)}</h2>
      <output class="counter-value" aria-live="polite">${escapeHtml(value)}</output>
      ${limits}
      <div class="counter-controls">
        <button class="counter-button" type="button" data-counter-action="decrement" aria-label="Decrease by ${escapeHtml(decrement)}" ${minimum != null && value <= minimum ? "disabled" : ""}>−${escapeHtml(decrement)}</button>
        <button class="counter-reset" type="button" data-counter-action="reset" ${value === resetValue ? "disabled" : ""}>Reset</button>
        <button class="counter-button" type="button" data-counter-action="increment" aria-label="Increase by ${escapeHtml(increment)}" ${maximum != null && value >= maximum ? "disabled" : ""}>+${escapeHtml(increment)}</button>
      </div>
      <p class="counter-error" role="alert"></p>
    </section>
  `;
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
  if (!card) return `<div class="empty-card">Empty</div>`;

  const cardTag = interactive ? "button" : "div";
  const cardAttributes = interactive ? ` data-card-id="${card.id}" type="button"` : "";
  const imagePath = getCardImagePath(card, true);
  const altText = card.faceDown ? `${card.rank} ${card.suit}, color inverted` : `${card.rank} ${card.suit}`;

  return `<${cardTag} class="playing-card ${card.faceDown ? "face-down" : ""}"${cardAttributes} style="--card-index:${index};--card-offset:${cardOffset}" aria-label="${altText}"><img src="${imagePath}" alt="${altText}" /></${cardTag}>`;
}

function renderHandCardSlot(card, index) {
  if (!card) return `<button class="playing-card hand-card-slot is-empty" type="button" disabled aria-hidden="true"></button>`;
  const altText = card.faceDown ? `${card.rank} ${card.suit}, color inverted` : `${card.rank} ${card.suit}`;
  return `<button class="playing-card hand-card-slot${card.faceDown ? " face-down" : ""}" type="button" data-card-id="${card.id}" aria-label="${altText}"><img src="${getCardImagePath(card, true)}" alt="${altText}" /></button>`;
}

const suitSymbols = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };

function renderHistory(history, playerNames) {
  return `<div id="game-history" class="game-history">${history.slice().reverse().map((event) => {
    const playerName = playerNames[event.playerId] || event.playerId;
    let message;
    if (event.type === "discard") {
      const faceDownCards = event.cards.filter((card) => card.faceDown);
      if (faceDownCards.length > 0) {
        const faceUpCards = formatCardList(event.cards.filter((card) => !card.faceDown));
        message = `${playerName} played ${faceDownCards.length} unknown cards${faceUpCards ? ` and ${faceUpCards}` : ""}`;
      } else {
        message = `${playerName} laid ${formatCardList(event.cards)}`;
      }
    } else if (event.type === "draw") {
      message = `${playerName} drew ${event.count} ${event.count === 1 ? "card" : "cards"}`;
    } else if (event.type === "knock") {
      message = `${playerName} knocked ${event.count} ${event.count === 1 ? "time" : "times"}`;
    } else if (event.type === "roll") {
      message = `${playerName} rolled ${event.dieName} and got ${event.result}`;
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
  document.querySelectorAll(".board-counter").forEach((counterPanel) => {
    const buttons = [...counterPanel.querySelectorAll("[data-counter-action]")];
    buttons.forEach((button) => button.addEventListener("click", async () => {
      const originalDisabledStates = buttons.map((item) => item.disabled);
      buttons.forEach((item) => { item.disabled = true; });
      counterPanel.querySelector(".counter-error").textContent = "";
      try {
        await gameRequest(`/api/game/${channelId}/counters/${encodeURIComponent(counterPanel.dataset.counterId)}/${button.dataset.counterAction}`, { playerId: currentPlayerId });
        await refreshGame(settings);
      } catch (error) {
        counterPanel.querySelector(".counter-error").textContent = error.message;
        buttons.forEach((item, index) => { item.disabled = originalDisabledStates[index]; });
      }
    }));
  });
  document.querySelector("#counter-add-button")?.addEventListener("click", () => {
    document.querySelector("#counter-dialog").showModal();
  });
  document.querySelector("#counter-dialog-close")?.addEventListener("click", () => {
    document.querySelector("#counter-dialog").close();
  });
  document.querySelector("#counter-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const counterForm = event.currentTarget;
    const form = new FormData(counterForm);
    const counter = {
      name: form.get("name"),
      increment: Number(form.get("increment")),
      decrement: Number(form.get("decrement")),
      minimum: form.get("minimum") === "" ? null : Number(form.get("minimum")),
      maximum: form.get("maximum") === "" ? null : Number(form.get("maximum")),
      showLimits: form.has("counter-show-limits"),
    };
    try {
      await gameRequest(`/api/game/${channelId}/counters`, counter);
      counterForm.closest("dialog").close();
      await refreshGame(settings);
    } catch (error) {
      document.querySelector("#counter-create-error").textContent = error.message;
    }
  });
  document.querySelector("#counters-toggle")?.addEventListener("click", () => {
    const list = document.querySelector("#counter-list");
    const isCollapsed = list.classList.toggle("is-collapsed");
    document.querySelector("#counters-toggle").setAttribute("aria-expanded", String(!isCollapsed));
  });
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
      const isFaceDown = Boolean(handCard && (handCard.faceDown || cardStates.get(handCard.id) === "face-down"));
      card.classList.toggle("is-empty", !handCard);
      card.classList.toggle("face-down", isFaceDown);
      card.classList.toggle("selected", Boolean(handCard && cardStates.has(handCard.id)));
      card.disabled = !handCard;
      if (!handCard) {
        card.removeAttribute("data-card-id");
        card.removeAttribute("aria-label");
        card.replaceChildren();
        return;
      }
      const displayedCard = { ...handCard, faceDown: isFaceDown };
      const altText = isFaceDown ? `${handCard.rank} ${handCard.suit}, color inverted` : `${handCard.rank} ${handCard.suit}`;
      card.dataset.cardId = handCard.id;
      card.setAttribute("aria-label", altText);
      card.replaceChildren(Object.assign(document.createElement("img"), { src: getCardImagePath(displayedCard, true), alt: altText }));
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
    discardPileButton.setAttribute("aria-label", card ? `Discard pile: ${card.rank} ${card.suit}` : "Discard pile empty");
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
  const rollDie = async (dieId) => {
    await gameRequest(`/api/game/${channelId}/dice/${encodeURIComponent(dieId)}/roll`, { playerId: currentPlayerId });
    await refreshGame(settings);
  };
  document.querySelectorAll("[data-die-id]").forEach((dieButton) => dieButton.addEventListener("click", (event) => {
    if (dieButton.dataset.dragged === "true") {
      delete dieButton.dataset.dragged;
      event.preventDefault();
      return;
    }
    rollDie(dieButton.dataset.dieId);
  }));
  document.querySelector("#dice-add-button")?.addEventListener("click", () => {
    document.querySelector("#dice-dialog").showModal();
  });
  document.querySelector("#dice-dialog-close")?.addEventListener("click", () => {
    document.querySelector("#dice-dialog").close();
  });
  document.querySelector("#dice-type")?.addEventListener("change", (event) => {
    document.querySelector("#custom-dice-fields").classList.toggle("is-hidden", event.target.value !== "custom");
  });
  document.querySelector("#dice-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const diceForm = event.currentTarget;
    const form = new FormData(diceForm);
    const type = form.get("type");
    const standardSides = { coin: ["Heads", "Tails"], d4: ["1", "2", "3", "4"], d6: ["1", "2", "3", "4", "5", "6"], d8: ["1", "2", "3", "4", "5", "6", "7", "8"], d10: Array.from({ length: 10 }, (_, index) => String(index + 1)), d12: Array.from({ length: 12 }, (_, index) => String(index + 1)), d20: Array.from({ length: 20 }, (_, index) => String(index + 1)) };
    const sides = type === "custom" ? String(form.get("sides")).split(",").map((side) => side.trim()).filter(Boolean) : standardSides[type];
    try {
      await gameRequest(`/api/game/${channelId}/dice`, { playerId: currentPlayerId, name: form.get("name"), sides });
      diceForm.closest("dialog").close();
      await refreshGame(settings);
    } catch (error) {
      const errorMessage = document.querySelector("#dice-error");
      if (errorMessage) errorMessage.textContent = error.message;
    }
  });
  document.querySelectorAll(".board-die").forEach(makeBoardItemDraggable);
  document.querySelectorAll(".board-counter").forEach((counter) => makeBoardItemDraggable(counter, true));
  const toggleDiceList = () => {
    document.querySelector("#dice-list").classList.toggle("is-collapsed");
    document.querySelector("#dice-add-button").classList.toggle("is-collapsed");
  };
  document.querySelector("#dice-toggle")?.addEventListener("click", toggleDiceList);
  document.querySelector(".dice-panel")?.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    toggleDiceList();
  });
}

async function gameRequest(url, body) { const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!response.ok) throw new Error((await response.json()).error || "Game action failed"); return response.json(); }
async function refreshGame(settings) { await loadGame(settings); }
function startPlayerHeartbeat() {
  const playerUrl = `/api/game/${encodeURIComponent(discordSdk.channelId)}/players/${encodeURIComponent(currentPlayerId)}`;
  const heartbeat = () => fetch(`${playerUrl}/heartbeat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerName: currentPlayerName }) }).catch(() => {});
  heartbeat();
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(heartbeat, 5000);
  window.addEventListener("beforeunload", () => {
    clearInterval(heartbeatTimer);
    clearInterval(pollTimer); 
    fetch(playerUrl, { method: "DELETE", keepalive: true }).catch(() => {});
  }, { once: true });
}

function makeBoardItemDraggable(item, ignoreButtons = false) {
  const itemId = item.dataset.dieId || item.dataset.counterId;
  const savedPosition = boardItemPositions.get(itemId);
  if (savedPosition) {
    item.style.left = `${savedPosition.left}px`;
    item.style.top = `${savedPosition.top}px`;
    item.style.right = "auto";
  }

  let dragState = null;
  item.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (ignoreButtons && event.target.closest("button")) return;
    event.stopPropagation();
    const bounds = item.getBoundingClientRect();
    const boardBounds = item.parentElement.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: bounds.left - boardBounds.left,
      originY: bounds.top - boardBounds.top,
      bounds,
      boardBounds,
      moved: false,
    };
    item.setPointerCapture(event.pointerId);
  });
  item.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(deltaX, deltaY) < 4) return;
    dragState.moved = true;
    const maxLeft = dragState.boardBounds.width - dragState.bounds.width;
    const maxTop = dragState.boardBounds.height - dragState.bounds.height;
    const nextLeft = Math.max(0, Math.min(maxLeft, dragState.originX + deltaX));
    const nextTop = Math.max(0, Math.min(maxTop, dragState.originY + deltaY));
    item.style.left = `${nextLeft}px`;
    item.style.top = `${nextTop}px`;
    item.style.right = "auto";
    boardItemPositions.set(itemId, { left: nextLeft, top: nextTop });
  });
  item.addEventListener("pointerup", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (dragState.moved) item.dataset.dragged = "true";
    dragState = null;
  });
  item.addEventListener("pointercancel", () => {
    dragState = null;
  });
}
