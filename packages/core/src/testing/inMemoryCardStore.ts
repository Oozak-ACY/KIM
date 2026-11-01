import type { Card, CardStore, Review } from "../index";

export function inMemoryCardStore(): CardStore {
  const cards: Card[] = [];
  const reviews: Review[] = [];
  return {
    async add(card) {
      const stored = { ...card, id: String(cards.length + 1) };
      cards.push(stored);
      return stored;
    },
    async list() {
      return [...cards];
    },
    async setTags(cardId, tags) {
      const index = cards.findIndex(({ id }) => id === cardId);
      const card = cards[index];
      if (!card) throw new Error(`Card ${cardId} not found`);
      const tagged = { ...card, tags };
      cards[index] = tagged;
      return tagged;
    },
    async recordReview(card, review) {
      const index = cards.findIndex(({ id }) => id === card.id);
      if (index === -1) throw new Error(`Card ${card.id} not found`);
      cards[index] = card;
      reviews.push(review);
    },
    async listReviews(cardId) {
      return reviews.filter((review) => review.cardId === cardId);
    },
  };
}
