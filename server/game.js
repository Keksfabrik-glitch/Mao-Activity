const SUITS = ["clubs", "diamonds", "hearts", "spades"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const KNOCK_WINDOW_MS = 5000;

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
    this.knockHistory = new Map();
    this.knockTimers = new Map();
    this.counterChangeHistory = new Map();
    this.counterChangeTimers = new Map();
    this.dice = [];
    this.nextDieId = 1;
    this.counters = [];
    this.nextCounterId = 1;
    this.drawPile = shuffle(createDeck(cardSets));
    this.discardPile = [this.drawPile.pop()];
  }

  addCounter(playerId, name, increment, decrement, minimum, maximum, showLimits, startingValue = null) {
    if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > 40) {
      throw new Error("A counter name is required and must be at most 40 characters");
    }
    if (!Number.isInteger(increment) || increment < 1 || increment > 1000000) {
      throw new Error("Counter increment must be between 1 and 1000000");
    }
    if (!Number.isInteger(decrement) || decrement < 1 || decrement > 1000000) {
      throw new Error("Counter decrement must be between 1 and 1000000");
    }
    if (minimum != null && !Number.isSafeInteger(minimum)) {
      throw new Error("Counter minimum must be a safe integer or null");
    }
    if (maximum != null && !Number.isSafeInteger(maximum)) {
      throw new Error("Counter maximum must be a safe integer or null");
    }
    if (minimum != null && maximum != null && minimum > maximum) {
      throw new Error("Counter minimum must not exceed its maximum");
    }
    if (startingValue != null && !Number.isSafeInteger(startingValue)) {
      throw new Error("Counter starting value must be a safe integer or null");
    }
    const initialValue = startingValue ?? minimum ?? 0;
    if ((minimum != null && initialValue < minimum) || (maximum != null && initialValue > maximum)) {
      throw new Error("Counter starting value must be within its minimum and maximum");
    }
    this.addPlayer(playerId);
    const counter = {
      id: `counter-${this.nextCounterId++}`,
      name: name.trim(),
      value: initialValue,
      increment,
      decrement,
      minimum: minimum ?? null,
      maximum: maximum ?? null,
      startingValue: initialValue,
      showLimits: Boolean(showLimits),
    };
    this.counters.push(counter);
    this.addHistory({ type: "counter-add", playerId, counterId: counter.id, counterName: counter.name });
    return counter;
  }

  updateCounter(counterId, action, playerId) {
    const counter = this.counters.find((item) => item.id === counterId);
    if (!counter) throw new Error("Counter not found");
    this.addPlayer(playerId);
    let value = counter.value;
    if (action === "increment") value += counter.increment;
    else if (action === "decrement") value -= counter.decrement;
    else if (action === "reset") value = counter.startingValue ?? counter.minimum ?? 0;
    else throw new Error("Unknown counter action");
    const updatedValue = this.clampCounterValue(counter, value);
    if (updatedValue !== counter.value) {
      counter.value = updatedValue;
      this.recordCounterChange(playerId, counter);
    }
    return counter.value;
  }

  recordCounterChange(playerId, counter) {
    const key = JSON.stringify([playerId, counter.id]);
    const historyEvent = this.counterChangeHistory.get(key)
      || this.addHistory({
        type: "counter-change",
        playerId,
        counterId: counter.id,
        counterName: counter.name,
        count: 0,
        value: counter.value,
      });
    historyEvent.count += 1;
    historyEvent.value = counter.value;
    this.counterChangeHistory.set(key, historyEvent);
    const timer = this.counterChangeTimers.get(key);
    if (timer) clearTimeout(timer);
    this.counterChangeTimers.set(key, setTimeout(() => {
      this.counterChangeHistory.delete(key);
      this.counterChangeTimers.delete(key);
    }, KNOCK_WINDOW_MS));
  }

  clampCounterValue(counter, value) {
    const boundedValue = Math.min(counter.maximum ?? value, Math.max(counter.minimum ?? value, value));
    if (!Number.isSafeInteger(boundedValue)) {
      throw new Error("Counter value exceeds the supported range");
    }
    return boundedValue;
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
    this.resetKnocks();
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
    this.resetKnocks();
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
    this.resetKnocks();
    this.addHistory({ type: "discard", playerId, cards });
    return cards;
  }

  knock(playerId) {
    this.addPlayer(playerId);
    const count = (this.knockCounts.get(playerId) || 0) + 1;
    this.clearKnockTimer(playerId);
    this.knockCounts.set(playerId, count);
    const historyEvent = this.knockHistory.get(playerId) || this.addHistory({ type: "knock", playerId, count: 0 });
    historyEvent.count = count;
    this.knockHistory.set(playerId, historyEvent);
    this.knockTimers.set(playerId, setTimeout(() => {
      this.knockCounts.delete(playerId);
      this.knockHistory.delete(playerId);
      this.knockTimers.delete(playerId);
    }, KNOCK_WINDOW_MS));
    return count;
  }

  resetKnocks() {
    for (const playerId of this.knockCounts.keys()) this.clearKnockTimer(playerId);
    this.knockCounts.clear();
    this.knockHistory.clear();
  }

  clearKnockTimer(playerId) {
    const timer = this.knockTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.knockTimers.delete(playerId);
  }

  addDie(playerId, name, sides) {
    this.addPlayer(playerId);
    if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > 40) {
      throw new Error("A die name is required and must be at most 40 characters");
    }
    if (!Array.isArray(sides) || sides.length < 2 || sides.length > 100 || sides.some((side) => typeof side !== "string" || side.trim().length === 0 || side.length > 80)) {
      throw new Error("A die must have between 2 and 100 non-empty sides");
    }
    const die = { id: `die-${this.nextDieId++}`, name: name.trim(), sides: sides.map((side) => side.trim()), createdBy: playerId };
    this.dice.push(die);
    return die;
  }

  rollDie(playerId, dieId) {
    this.addPlayer(playerId);
    const die = this.dice.find((candidate) => candidate.id === dieId);
    if (!die) throw new Error("Die not found");
    const result = die.sides[Math.floor(Math.random() * die.sides.length)];
    this.addHistory({ type: "roll", playerId, dieId: die.id, dieName: die.name, result });
    return { die, result };
  }

  addHistory(event) {
    const historyEvent = { id: `${Date.now()}-${this.history.length}`, ...event };
    this.history.push(historyEvent);
    if (this.history.length > 100) this.history.shift();
    return historyEvent;
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
      dice: this.dice.map((die) => ({ ...die, sides: [...die.sides] })),
      counters: this.counters.map((counter) => ({ ...counter })),
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
