import type {
  Card,
  CardChanges,
  CardStore,
  QuizQuestion,
  Review,
  Schedule,
} from "@kim/core";
import { supabase } from "./supabase";

const CARD_COLUMNS =
  "id, cue, essence, hints, quiz_questions, quiz_mode, quiz_turn, tags, archived, created_at, due_at, fsrs_schedule";

type CardRow = {
  id: string;
  cue: string;
  essence: string;
  hints: string;
  quiz_questions: QuizQuestion[];
  quiz_mode: boolean;
  quiz_turn: number;
  tags: string[];
  archived: boolean;
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
    hints: row.hints,
    quizQuestions: row.quiz_questions,
    quizMode: row.quiz_mode,
    quizTurn: row.quiz_turn,
    tags: row.tags,
    archived: row.archived,
    createdAt: new Date(row.created_at),
    dueAt: new Date(row.due_at),
    schedule: row.fsrs_schedule,
  };
}

function toRow(changes: CardChanges): Partial<CardRow> {
  const { dueAt, schedule, quizQuestions, quizMode, quizTurn, ...same } =
    changes;
  return {
    ...same,
    ...(dueAt && { due_at: dueAt.toISOString() }),
    ...(schedule && { fsrs_schedule: schedule }),
    ...(quizQuestions && { quiz_questions: quizQuestions }),
    ...(quizMode !== undefined && { quiz_mode: quizMode }),
    ...(quizTurn !== undefined && { quiz_turn: quizTurn }),
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
  async add({ createdAt, ...card }) {
    const { data, error } = await supabase
      .from("cards")
      .insert({ ...toRow(card), created_at: createdAt.toISOString() })
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

  async update(cardId, changes) {
    const { data, error } = await supabase
      .from("cards")
      .update(toRow(changes))
      .eq("id", cardId)
      .select(CARD_COLUMNS)
      .single();
    if (error) throw error;
    return toCard(data);
  },

  async recordReview(card, review) {
    const { error } = await supabase.rpc("record_review", {
      review_card_id: card.id,
      new_due_at: card.dueAt.toISOString(),
      new_fsrs_schedule: card.schedule,
      new_quiz_turn: card.quizTurn,
      review_reviewed_at: review.reviewedAt.toISOString(),
      review_grade: review.grade,
      review_channel: review.channel,
      review_mode: review.mode,
    });
    if (error) throw error;
  },

  async remove(cardId) {
    const { error } = await supabase.from("cards").delete().eq("id", cardId);
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
