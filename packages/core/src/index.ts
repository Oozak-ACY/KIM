import {
  firstSchedule,
  nextSchedule,
  type Grade,
  type Schedule,
} from "./scheduling";

export type { Grade, Schedule };

export type Card = {
  id: string;
  cue: string;
  essence: string;
  createdAt: Date;
  dueAt: Date;
  schedule: Schedule;
};

export type NewCard = Omit<Card, "id">;

export type ReviewChannel = "app";
export type ReviewMode = "recall";
export type RecallOutcome = "remembered" | "forgotten";

export type Review = {
  cardId: string;
  reviewedAt: Date;
  grade: Grade;
  channel: ReviewChannel;
  mode: ReviewMode;
};

export type CardStore = {
  add(card: NewCard): Promise<Card>;
  list(): Promise<Card[]>;
  /** Saves the rescheduled Card and its Review together, or neither. */
  recordReview(card: Card, review: Review): Promise<void>;
  listReviews(cardId: string): Promise<Review[]>;
};

export type Clock = {
  now(): Date;
};

export const CUE_MAX_CHARACTERS = 100;
export const ESSENCE_MAX_CHARACTERS = 280;
export const ESSENCE_MAX_LINES = 3;

const RECALL_GRADES: Record<RecallOutcome, Grade> = {
  remembered: "good",
  forgotten: "again",
};

export type CardProblem =
  | "cue-missing"
  | "cue-too-long"
  | "essence-missing"
  | "essence-too-long"
  | "essence-too-many-lines";

export type CreateCardResult =
  | { ok: true; card: Card }
  | { ok: false; problems: CardProblem[] };

function characterCount(text: string): number {
  return [...text].length;
}

function bulletLineCount(essence: string): number {
  return essence.split("\n").filter((line) => line.trim() !== "").length;
}

/** What is left of the Essence allowance; negative once a limit is passed. */
export function essenceRoom(essence: string): {
  characters: number;
  lines: number;
} {
  return {
    characters: ESSENCE_MAX_CHARACTERS - characterCount(essence),
    lines: ESSENCE_MAX_LINES - bulletLineCount(essence),
  };
}

function findProblems(input: { cue: string; essence: string }): CardProblem[] {
  const problems: CardProblem[] = [];
  if (input.cue.trim() === "") problems.push("cue-missing");
  if (characterCount(input.cue) > CUE_MAX_CHARACTERS) {
    problems.push("cue-too-long");
  }
  if (input.essence.trim() === "") problems.push("essence-missing");
  const room = essenceRoom(input.essence);
  if (room.characters < 0) problems.push("essence-too-long");
  if (room.lines < 0) problems.push("essence-too-many-lines");
  return problems;
}

export function createCore({ clock, cards }: { clock: Clock; cards: CardStore }) {
  return {
    async createCard(input: {
      cue: string;
      essence: string;
    }): Promise<CreateCardResult> {
      const problems = findProblems(input);
      if (problems.length > 0) return { ok: false, problems };

      const now = clock.now();
      const card = await cards.add({
        ...input,
        createdAt: now,
        ...(await firstSchedule(now)),
      });
      return { ok: true, card };
    },

    async listCards(): Promise<Card[]> {
      const stored = await cards.list();
      return stored.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
    },

    async dueCards(): Promise<Card[]> {
      const now = clock.now();
      const stored = await cards.list();
      return stored
        .filter((card) => card.dueAt <= now)
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    },

    async recordReview({
      card,
      mode,
      outcome,
      channel,
    }: {
      card: Card;
      mode: ReviewMode;
      outcome: RecallOutcome;
      channel: ReviewChannel;
    }): Promise<Card> {
      const reviewedAt = clock.now();
      const grade = RECALL_GRADES[outcome];
      const reviewed = {
        ...card,
        ...(await nextSchedule(card, grade, reviewedAt)),
      };
      await cards.recordReview(reviewed, {
        cardId: card.id,
        reviewedAt,
        grade,
        channel,
        mode,
      });
      return reviewed;
    },

    listReviews(cardId: string): Promise<Review[]> {
      return cards.listReviews(cardId);
    },
  };
}
