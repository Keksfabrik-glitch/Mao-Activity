const SUITS = ["clubs", "diamonds", "hearts", "spades"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export class MaoGame {
  constructor(cardSets, faceDownCardsPlayable, taxes = 50, taxesMinimum = 15) {
    this.cardSets = cardSets;
    this.faceDownCardsPlayable = faceDownCardsPlayable;
    this.taxes = taxes;
    this.taxesMinimum = taxesMinimum;
    this.players = new Map();
    this.playerNames = new Map();
    this.history = [];
    this.knockCounts = new Map();
    this.drawPile = shuffle(createDeck(cardSets));
    this.discardPile = [this.drawPile.pop()];
  }

  addPlayer(playerId, playerName = null) {
    if (!playerId || typeof playerId !== "string") {
      throw new Error("playerId is required");
    }
    if (!this.players.has(playerId)) {
      this.players.set(playerId, []);
    }
    if (playerName) this.playerNames.set(playerId, playerName);
    else if (!this.playerNames.has(playerId)) this.playerNames.set(playerId, playerId);
  }

  drawToPlayer(playerId, count, historyType = "draw") {
    this.addPlayer(playerId);
    const cards = this.drawCards(count);
    this.players.get(playerId).push(...cards);
    this.addHistory({ type: historyType, playerId, count });
    return cards;
  }

  giveCards(fromPlayerId, toPlayerId, cardIds) {
    this.addPlayer(fromPlayerId);
    this.addPlayer(toPlayerId);
    const sourceHand = this.players.get(fromPlayerId);
    const cards = takeCards(sourceHand, cardIds);
    this.players.set(fromPlayerId, sourceHand.filter((card) => !cardIds.includes(card.id)));
    this.players.get(toPlayerId).push(...cards);
    this.addHistory({ type: "give", playerId: fromPlayerId, toPlayerId, count: cards.length });
    return cards;
  }

  giveFromDraw(toPlayerId, count) {
    return this.drawToPlayer(toPlayerId, count, "give");
  }

  discardCards(playerId, cardIds, faceDown = false) {
    this.addPlayer(playerId);
    const hand = this.players.get(playerId);
    const faceDownIds = faceDown instanceof Set
      ? faceDown
      : new Set(faceDown ? cardIds : []);
    const cards = takeCards(hand, cardIds).map((card) => ({
      ...card,
      faceDown: faceDownIds.has(card.id),
    }));
    this.players.set(playerId, hand.filter((card) => !cardIds.includes(card.id)));
    this.discardPile.push(...cards);
    this.addHistory({ type: "discard", playerId, cards });
    return cards;
  }

  knock(playerId) {
    this.addPlayer(playerId);
    const count = (this.knockCounts.get(playerId) || 0) + 1;
    this.knockCounts.set(playerId, count);
    this.addHistory({ type: "knock", playerId, count });
    return count;
  }

  addHistory(event) {
    this.history.push({ id: `${Date.now()}-${this.history.length}`, ...event });
    if (this.history.length > 100) this.history.shift();
  }

  drawCards(count) {
    validateCount(count);
    const cards = [];
    while (cards.length < count) {
      if (this.drawPile.length <= 1) {
        this.recycleDiscardPile();
      }
      if (this.drawPile.length === 0) {
        throw new Error("Not enough cards available");
      }
      cards.push(this.drawPile.pop());
    }
    return cards;
  }

  recycleDiscardPile() {
    if (this.drawPile.length > 1) {
      return;
    }

    if (this.discardPile.length >= 2) {
      const topCard = this.discardPile[this.discardPile.length - 1];
      let keepCount = 1;
      for (let index = this.discardPile.length - 2; index >= 0; index -= 1) {
        if (this.discardPile[index].rank !== topCard.rank) {
          break;
        }
        keepCount += 1;
      }

      const recycleEnd = this.discardPile.length - keepCount;
      const recycledCards = this.discardPile.splice(0, recycleEnd).map((card) => ({
        ...card,
        faceDown: false,
      }));
      this.drawPile.push(...shuffle(recycledCards));
    }

    for (const [playerId, hand] of this.players) {
      if (hand.length <= this.taxesMinimum || this.taxes === 0) {
        continue;
      }
      const taxCount = Math.floor(hand.length * this.taxes / 100);
      const taxedCards = shuffle(hand).slice(0, taxCount).map((card) => ({
        ...card,
        faceDown: false,
      }));
      const taxedIds = new Set(taxedCards.map((card) => card.id));
      this.players.set(playerId, hand.filter((card) => !taxedIds.has(card.id)));
      this.drawPile.push(...taxedCards);
    }

    this.drawPile = shuffle(this.drawPile);
  }

  snapshot() {
    return {
      cardSets: this.cardSets,
      taxes: this.taxes,
      taxesMinimum: this.taxesMinimum,
      drawPileCount: this.drawPile.length,
      discardPile: [...this.discardPile],
      playerNames: Object.fromEntries(this.playerNames),
      history: [...this.history],
      players: Object.fromEntries(
        [...this.players].map(([playerId, hand]) => [playerId, [...hand]])
      ),
    };
  }
}

export function createDeck(cardSets) {
  if (!Number.isInteger(cardSets) || cardSets < 1 || cardSets > 5) {
    throw new Error("cardSets must be between 1 and 5");
  }

  return Array.from({ length: cardSets }, (_, deckIndex) =>
    SUITS.flatMap((suit) => RANKS.map((rank) => ({
      id: `${deckIndex + 1}-${suit}-${rank}`,
      deck: deckIndex + 1,
      suit,
      rank,
      faceDown: false,
    })))
  ).flat();
}

function takeCards(hand, cardIds) {
  if (!Array.isArray(cardIds) || cardIds.length === 0 || new Set(cardIds).size !== cardIds.length) {
    throw new Error("cardIds must be a non-empty array without duplicates");
  }
  const cards = cardIds.map((cardId) => hand.find((card) => card.id === cardId));
  if (cards.some((card) => card == null)) {
    throw new Error("One or more cards are not in the player's hand");
  }
  return cards;
}

function validateCount(count) {
  if (!Number.isInteger(count) || count < 0 || count > 260) {
    throw new Error("count must be between 0 and 260");
  }
}

function shuffle(cards) {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}
