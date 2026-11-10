import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { MaoGame } from "./game.js";
dotenv.config({ path: "../.env" });

const app = express();
const port = 3001;
const settingsFile = fileURLToPath(new URL("./settings.json", import.meta.url));
let gameSettings = loadSettings();
const games = new Map();
const activePlayers = new Map();
const PLAYER_TIMEOUT_MS = 15000;
const DEFAULT_SETTINGS = {
  cardSets: 3,
  taxes: 50,
  taxesMinimum: 15,
  dice: true,
  customDice: true,
  faceDownCardsPlayable: true,
  counters: true,
};

function loadSettings() {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    // Ignore the previous global format when switching to channel-based storage.
    return settings && typeof settings === "object" && settings.cardSets == null ? settings : {};
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Could not load game settings", error);
    }
    return {};
  }
}

function persistSettings() {
  fs.writeFileSync(settingsFile, `${JSON.stringify(gameSettings, null, 2)}\n`);
}

function touchPlayer(channelId, playerId) {
  if (!activePlayers.has(channelId)) activePlayers.set(channelId, new Map());
  activePlayers.get(channelId).set(playerId, Date.now());
}

function resetChannel(channelId) {
  delete gameSettings[channelId];
  games.delete(channelId);
  activePlayers.delete(channelId);
  persistSettings();
}

function removePlayer(channelId, playerId) {
  const players = activePlayers.get(channelId);
  if (!players) return;
  players.delete(playerId);
  games.get(channelId)?.players.delete(playerId);
  if (players.size === 0) resetChannel(channelId);
}

setInterval(() => {
  const now = Date.now();
  for (const [channelId, players] of activePlayers) {
    for (const [playerId, lastSeen] of players) {
      if (now - lastSeen > PLAYER_TIMEOUT_MS) removePlayer(channelId, playerId);
    }
  }
}, 5000);

// Allow express to parse JSON bodies
app.use(express.json());

app.get("/api/settings/:channelId", (req, res) => {
  res.send({ settings: gameSettings[req.params.channelId] || null });
});

app.post("/api/settings/:channelId", (req, res) => {
  if (gameSettings[req.params.channelId] != null) {
    return res.status(409).send({
      error: "Game settings for this voice channel have already been saved",
      settings: gameSettings[req.params.channelId],
    });
  }

  saveSettings(req.params.channelId, req.body, res);
});

app.put("/api/settings/:channelId", (req, res) => {
  saveSettings(req.params.channelId, req.body, res);
});

function saveSettings(channelId, settings, res) {
  settings = { ...DEFAULT_SETTINGS, ...settings };

  if (!settings || !Number.isInteger(settings.cardSets) || settings.cardSets < 2 || settings.cardSets > 5) {
    return res.status(400).send({ error: "cardSets must be between 2 and 5" });
  }

  if (!Number.isInteger(settings.taxes) || settings.taxes < 0 || settings.taxes > 100) {
    return res.status(400).send({ error: "taxes must be between 0 and 100" });
  }

  if (!Number.isInteger(settings.taxesMinimum) || settings.taxesMinimum < 0 || settings.taxesMinimum > 260) {
    return res.status(400).send({ error: "taxesMinimum must be between 0 and 260" });
  }

  const savedSettings = {
    cardSets: settings.cardSets,
    taxes: settings.taxes,
    taxesMinimum: settings.taxesMinimum,
    dice: Boolean(settings.dice),
    customDice: Boolean(settings.customDice),
    faceDownCardsPlayable: Boolean(settings.faceDownCardsPlayable),
    counters: Boolean(settings.counters),
  };

  gameSettings[channelId] = savedSettings;
  games.set(channelId, new MaoGame(
    savedSettings.cardSets,
    savedSettings.faceDownCardsPlayable,
    savedSettings.taxes,
    savedSettings.taxesMinimum
  ));
  persistSettings();
  res.send({ settings: savedSettings });
}

function getGame(channelId) {
  const settings = gameSettings[channelId];
  if (!settings) {
    return null;
  }
  if (!games.has(channelId)) {
    games.set(channelId, new MaoGame(
      settings.cardSets,
      settings.faceDownCardsPlayable,
      settings.taxes,
      settings.taxesMinimum
    ));
  }
  return games.get(channelId);
}

app.get("/api/game/:channelId", (req, res) => {
  const game = getGame(req.params.channelId);
  if (!game) {
    return res.status(404).send({ error: "No settings exist for this voice channel" });
  }
  if (req.query.playerId) {
    touchPlayer(req.params.channelId, req.query.playerId);
      game.addPlayer(req.query.playerId, req.query.playerName);
  }
  res.send({ game: game.snapshot() });
});

app.post("/api/game/:channelId/counters", (req, res) => {
  const game = getGame(req.params.channelId);
  if (!game) {
    return res.status(404).send({ error: "No settings exist for this voice channel" });
  }
  try {
    const counter = game.addCounter(
      req.body.playerId,
      req.body.name,
      req.body.increment,
      req.body.decrement,
      req.body.minimum,
      req.body.maximum,
      req.body.showLimits,
      req.body.startingValue,
    );
    res.send({ counter, game: game.snapshot() });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

app.post("/api/game/:channelId/counters/:counterId/:action", (req, res) => {
  const game = getGame(req.params.channelId);
  if (!game) {
    return res.status(404).send({ error: "No settings exist for this voice channel" });
  }
  try {
    const value = game.updateCounter(req.params.counterId, req.params.action, req.body.playerId);
    res.send({ value, game: game.snapshot() });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

app.post("/api/game/:channelId/players/:playerId/heartbeat", (req, res) => {
  touchPlayer(req.params.channelId, req.params.playerId);
  if (getGame(req.params.channelId)) getGame(req.params.channelId).addPlayer(req.params.playerId, req.body.playerName);
  res.send({ ok: true });
});

app.delete("/api/game/:channelId/players/:playerId", (req, res) => {
  removePlayer(req.params.channelId, req.params.playerId);
  res.send({ ok: true });
});

app.post("/api/game/:channelId/draw", (req, res) => {
  const game = getGame(req.params.channelId);
  if (!game) {
    return res.status(404).send({ error: "No settings exist for this voice channel" });
  }
  try {
    const cards = game.drawToPlayer(req.body.playerId, req.body.count);
    res.send({ cards, game: game.snapshot() });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

app.post("/api/game/:channelId/knock", (req, res) => {
  const game = getGame(req.params.channelId);
  if (!game) {
    return res.status(404).send({ error: "No settings exist for this voice channel" });
  }
  try {
    const count = game.knock(req.body.playerId);
    res.send({ count, game: game.snapshot() });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

app.post("/api/game/:channelId/dice", (req, res) => {
  const game = getGame(req.params.channelId);
  if (!game) {
    return res.status(404).send({ error: "No settings exist for this voice channel" });
  }
  try {
    const die = game.addDie(req.body.playerId, req.body.name, req.body.sides);
    res.send({ die, game: game.snapshot() });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

app.post("/api/game/:channelId/dice/:dieId/roll", (req, res) => {
  const game = getGame(req.params.channelId);
  if (!game) {
    return res.status(404).send({ error: "No settings exist for this voice channel" });
  }
  try {
    const roll = game.rollDie(req.body.playerId, req.params.dieId);
    res.send({ ...roll, game: game.snapshot() });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

app.post("/api/game/:channelId/give-from-draw", (req, res) => {
  const game = getGame(req.params.channelId);
  if (!game) {
    return res.status(404).send({ error: "No settings exist for this voice channel" });
  }
  try {
    const cards = game.giveFromDraw(req.body.toPlayerId, req.body.count);
    res.send({ cards, game: game.snapshot() });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

app.post("/api/game/:channelId/give", (req, res) => {
  const game = getGame(req.params.channelId);
  if (!game) {
    return res.status(404).send({ error: "No settings exist for this voice channel" });
  }
  try {
    const cards = game.giveCards(req.body.fromPlayerId, req.body.toPlayerId, req.body.cardIds);
    res.send({ cards, game: game.snapshot() });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

app.post("/api/game/:channelId/discard", (req, res) => {
  const game = getGame(req.params.channelId);
  if (!game) {
    return res.status(404).send({ error: "No settings exist for this voice channel" });
  }
  try {
    const faceDownCardIds = new Set(req.body.faceDownCardIds || []);
    if (faceDownCardIds.size > 0 && !game.faceDownCardsPlayable) {
      return res.status(400).send({ error: "Face-down cards are disabled in the settings" });
    }
    const cards = game.discardCards(req.body.playerId, req.body.cardIds, faceDownCardIds);
    res.send({ cards, game: game.snapshot() });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

app.post("/api/game/:channelId/return-cards", (req, res) => {
  const game = getGame(req.params.channelId);
  if (!game) {
    return res.status(404).send({ error: "No settings exist for this voice channel" });
  }
  try {
    const cards = game.returnCards(req.body.playerId, req.body.cardIds);
    res.send({ cards, game: game.snapshot() });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

app.post("/api/token", async (req, res) => {
  
  // Exchange the code for an access_token
  const response = await fetch(`https://discord.com/api/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: process.env.VITE_DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: req.body.code,
    }),
  });

  // Retrieve the access_token from the response
  const { access_token } = await response.json();

  // Return the access_token to our client as { access_token: "..."}
  res.send({access_token});
});

app.use("/api", (req, res) => {
  res.status(404).send({ error: "API endpoint not found" });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
