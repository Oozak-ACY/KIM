import type {
  Card,
  CardChanges,
  CardStore,
  NewCard,
  QuizQuestion,
  Review,
  Schedule,
  Source,
} from "@kim/core";
import type { SupabaseClient } from "@supabase/supabase-js";

const CARD_COLUMNS =
  "id, cue, essence, hints, quiz_questions, quiz_mode, quiz_turn, tags, archived, archive_proposal_declined, source_assistant, source_conversation, created_at, due_at, fsrs_schedule";

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
  archive_proposal_declined: boolean;
  source_assistant: string | null;
  source_conversation: string | null;
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

function toSource(row: CardRow): Source | null {
  return row.source_assistant !== null && row.source_conversation !== null
    ? { assistant: row.source_assistant, conversation: row.source_conversation }
    : null;
}

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
    archiveProposalDeclined: row.archive_proposal_declined,
    source: toSource(row),
    createdAt: new Date(row.created_at),
    dueAt: new Date(row.due_at),
    schedule: row.fsrs_schedule,
  };
}

function toRow(changes: CardChanges): Partial<CardRow> {
  const {
    dueAt,
    schedule,
    quizQuestions,
    quizMode,
    quizTurn,
    archiveProposalDeclined,
    source,
    ...same
  } = changes;
  return {
    ...same,
    ...(source !== undefined && {
      source_assistant: source?.assistant ?? null,
      source_conversation: source?.conversation ?? null,
    }),
    ...(dueAt && { due_at: dueAt.toISOString() }),
    ...(schedule && { fsrs_schedule: schedule }),
    ...(quizQuestions && { quiz_questions: quizQuestions }),
    ...(quizMode !== undefined && { quiz_mode: quizMode }),
    ...(quizTurn !== undefined && { quiz_turn: quizTurn }),
    ...(archiveProposalDeclined !== undefined && {
      archive_proposal_declined: archiveProposalDeclined,
    }),
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

function toNewRow({ createdAt, ...card }: NewCard): Partial<CardRow> {
  return { ...toRow(card), created_at: createdAt.toISOString() };
}

export function supabaseCardStore(supabase: SupabaseClient): CardStore {
  return {
    async add(card) {
      const { data, error } = await supabase
        .from("cards")
        .insert(toNewRow(card))
        .select(CARD_COLUMNS)
        .single();
      if (error) throw error;
      return toCard(data);
    },

    async capture(card) {
      const { data, error } = await supabase.rpc("capture_card", {
        card: toNewRow(card),
      });
      if (error) throw error;
      return toCard(data);
    },

    async listCaptures(since) {
      const { data, error } = await supabase
        .from("captured_cards")
        .select("captured_at")
        .gte("captured_at", since.toISOString());
      if (error) throw error;
      return data.map(({ captured_at }) => new Date(captured_at));
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
}
