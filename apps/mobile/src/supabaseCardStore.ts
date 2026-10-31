import type { Card, CardStore, Review, Schedule } from "@kim/core";
import { supabase } from "./supabase";

const CARD_COLUMNS = "id, cue, essence, created_at, due_at, fsrs_schedule";

type CardRow = {
  id: string;
  cue: string;
  essence: string;
  created_at: string;
  due_at: string;
  fsrs_schedule: Schedule;
};

type ReviewRow = {
  card_id: string;
  reviewed_at: string;
  grade: Review["grade"];
  channel: Review["channel"];
  mode: Review["mode"];
};

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    cue: row.cue,
    essence: row.essence,
    createdAt: new Date(row.created_at),
    dueAt: new Date(row.due_at),
    schedule: row.fsrs_schedule,
  };
}

function toReview(row: ReviewRow): Review {
  return {
    cardId: row.card_id,
    reviewedAt: new Date(row.reviewed_at),
    grade: row.grade,
    channel: row.channel,
    mode: row.mode,
  };
}

export const supabaseCardStore: CardStore = {
  async add(card) {
    const { data, error } = await supabase
      .from("cards")
      .insert({
        cue: card.cue,
        essence: card.essence,
        created_at: card.createdAt.toISOString(),
        due_at: card.dueAt.toISOString(),
        fsrs_schedule: card.schedule,
      })
      .select(CARD_COLUMNS)
      .single();
    if (error) throw error;
    return toCard(data);
  },

  async list() {
    const { data, error } = await supabase
      .from("cards")
      .select(CARD_COLUMNS)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data.map(toCard);
  },

  async recordReview(card, review) {
    const { error } = await supabase.rpc("record_review", {
      review_card_id: card.id,
      new_due_at: card.dueAt.toISOString(),
      new_fsrs_schedule: card.schedule,
      review_reviewed_at: review.reviewedAt.toISOString(),
      review_grade: review.grade,
      review_channel: review.channel,
      review_mode: review.mode,
    });
    if (error) throw error;
  },

  async listReviews(cardId) {
    const { data, error } = await supabase
      .from("reviews")
      .select("card_id, reviewed_at, grade, channel, mode")
      .eq("card_id", cardId)
      .order("reviewed_at");
    if (error) throw error;
    return data.map(toReview);
  },
};
