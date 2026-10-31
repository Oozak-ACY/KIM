import type { Card, CardStore } from "../index";

export function inMemoryCardStore(): CardStore {
  const cards: Card[] = [];
  return {
    async add(card) {
      const stored = { ...card, id: String(cards.length + 1) };
      cards.push(stored);
      return stored;
    },
    async list() {
      return [...cards];
    },
  };
}
