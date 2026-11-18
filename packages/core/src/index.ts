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
  /** An optional mnemonic, analogy or example; empty when there is none. */
  hints: string;
  /** Asked in turn by Quiz mode Reviews; at most QUIZ_QUESTIONS_MAX. */
  quizQuestions: QuizQuestion[];
  /** Reviewed with a Quiz question rather than by its Cue. */
  quizMode: boolean;
  /** How many Quiz mode Reviews the Card has had, to rotate its Quiz questions. */
  quizTurn: number;
  tags: string[];
  /** Kept and searchable, but never due. */
  archived: boolean;
  createdAt: Date;
  dueAt: Date;
  schedule: Schedule;
};

/** A question about a Card with the answer the user expects. */
export type QuizQuestion = { question: string; answer: string };

export type NewCard = Omit<Card, "id">;

/** Fields of a Card a store changes in place; the others are left alone. */
export type CardChanges = Partial<Omit<Card, "id" | "createdAt">>;

export type ReviewChannel = "app";
export type ReviewMode = "recall" | "quiz";

/** How a Card is reviewed next, with the Quiz question to ask in Quiz mode. */
export type ReviewStyle =
  | { mode: "recall" }
  | { mode: "quiz"; quizQuestion: QuizQuestion };
export type RecallOutcome = "remembered" | "forgotten";
/** How the user grades their answer to a Quiz question. */
export type QuizOutcome = "forgot" | "hard" | "good";

/** A Review to record: a Recall mode or a Quiz mode one, with its outcome. */
export type ReviewAnswer =
  | { mode: "recall"; outcome: RecallOutcome }
  | { mode: "quiz"; outcome: QuizOutcome };

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
  /** Changes the given fields of the Card and returns it. */
  update(cardId: string, changes: CardChanges): Promise<Card>;
  /**
   * Saves the Card's new due date, schedule and Quiz turn with its Review,
   * or none of them. The rest of the Card is left alone, as it may have
   * changed since.
   */
  recordReview(card: Card, review: Review): Promise<void>;
  listReviews(cardId: string): Promise<Review[]>;
  /** Deletes the Card and its Reviews for good. */
  remove(cardId: string): Promise<void>;
};

/** The user's choices, kept with their Account. */
export type Settings = {
  /** Whether a newly created Card starts in Quiz mode. */
  newCardsInQuizMode: boolean;
};

export const DEFAULT_SETTINGS: Settings = { newCardsInQuizMode: false };

export type SettingsStore = {
  /** The current Account's Settings, or the defaults if never changed. */
  get(): Promise<Settings>;
  /** Changes the given Settings and returns them all. */
  update(changes: Partial<Settings>): Promise<Settings>;
};

export type Clock = {
  now(): Date;
};

/** A linked Account has signed in with Google or email at least once. */
export type Account = { id: string; linked: boolean };

export type SignInMethod =
  | { provider: "google" }
  | { provider: "email"; email: string };

/**
 * How a sign-in went. "email-sent" means it completes when the user opens
 * the link we emailed them.
 */
export type SignInAttempt = "done" | "email-sent" | "cancelled";

/** How a link went; "taken" means the identity already has another Account. */
export type LinkAttempt = SignInAttempt | "taken";

export type ConnectResult =
  | { ok: true; status: "linked" | "signed-in" | "email-sent" | "cancelled" }
  | { ok: false; problem: "email-invalid" };

/** Just enough to catch a typo; the emailed link proves the address. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AccountStore = {
  current(): Promise<Account>;
  /** Adds the identity to the current account, which keeps all its data. */
  link(method: SignInMethod): Promise<LinkAttempt>;
  /** Switches this device to the account that owns the identity. */
  signIn(method: SignInMethod): Promise<SignInAttempt>;
  /**
   * Finishes a link or sign-in from the link we emailed. False when the link
   * is not one of ours or no longer valid.
   */
  completeEmailLink(link: string): Promise<boolean>;
  /**
   * Deletes the current account with all its Cards, Reviews and settings,
   * then starts a fresh anonymous account.
   */
  deleteAccount(): Promise<void>;
};

export const CUE_MAX_CHARACTERS = 100;
export const ESSENCE_MAX_CHARACTERS = 280;
export const ESSENCE_MAX_LINES = 3;
export const HINTS_MAX_CHARACTERS = 280;
export const QUIZ_QUESTIONS_MAX = 3;

const RECALL_GRADES: Record<RecallOutcome, Grade> = {
  remembered: "good",
  forgotten: "again",
};

const QUIZ_GRADES: Record<QuizOutcome, Grade> = {
  forgot: "again",
  hard: "hard",
  good: "good",
};

function gradeOf(answer: ReviewAnswer): Grade {
  return answer.mode === "quiz"
    ? QUIZ_GRADES[answer.outcome]
    : RECALL_GRADES[answer.outcome];
}

/** What the user writes on a Card. */
export type CardContent = {
  cue: string;
  essence: string;
  hints?: string;
  quizQuestions?: QuizQuestion[];
};

/**
 * A Card as written in the form. Left out, Quiz mode follows the setting for
 * a new Card and stays as it was for an edited one.
 */
export type CardDraft = CardContent & { quizMode?: boolean };

export type CardProblem =
  | "cue-missing"
  | "cue-too-long"
  | "essence-missing"
  | "essence-too-long"
  | "essence-too-many-lines"
  | "hints-too-long"
  | "too-many-quiz-questions"
  | "quiz-question-missing"
  | "quiz-answer-missing";

export type CardResult =
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

function findProblems(input: Required<CardContent>): CardProblem[] {
  const problems: CardProblem[] = [];
  if (input.cue.trim() === "") problems.push("cue-missing");
  if (characterCount(input.cue) > CUE_MAX_CHARACTERS) {
    problems.push("cue-too-long");
  }
  if (input.essence.trim() === "") problems.push("essence-missing");
  const room = essenceRoom(input.essence);
  if (room.characters < 0) problems.push("essence-too-long");
  if (room.lines < 0) problems.push("essence-too-many-lines");
  if (characterCount(input.hints) > HINTS_MAX_CHARACTERS) {
    problems.push("hints-too-long");
  }
  if (input.quizQuestions.length > QUIZ_QUESTIONS_MAX) {
    problems.push("too-many-quiz-questions");
  }
  if (input.quizQuestions.some(({ question }) => question.trim() === "")) {
    problems.push("quiz-question-missing");
  }
  if (input.quizQuestions.some(({ answer }) => answer.trim() === "")) {
    problems.push("quiz-answer-missing");
  }
  return problems;
}

/** The content as stored, with no Hints or Quiz questions spelled out as empty. */
function checkContent({
  hints = "",
  quizQuestions = [],
  ...input
}: CardContent):
  | { ok: true; content: Required<CardContent> }
  | { ok: false; problems: CardProblem[] } {
  const content = {
    ...input,
    hints,
    quizQuestions: quizQuestions.map(({ question, answer }) => ({
      question,
      answer,
    })),
  };
  const problems = findProblems(content);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, content };
}

/** Ignores case and accents, so "energie" finds "Énergie". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Tags ignore case only: "pêche" and "péché" are different Tags. */
function tagKey(tag: string): string {
  return tag.normalize().toLowerCase();
}

function uniqueTags(tags: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const tag of tags) {
    if (!byKey.has(tagKey(tag))) byKey.set(tagKey(tag), tag);
  }
  return [...byKey.values()];
}

function newestFirst(cards: Card[]): Card[] {
  return [...cards].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

export type CardSearch = { text?: string; tag?: string };

/** Keeps the Cards matching the search, in the order given. */
export function matchingCards(
  cards: Card[],
  { text = "", tag }: CardSearch,
): Card[] {
  const words = fold(text).split(/\s+/).filter(Boolean);
  const wantedTag = tag === undefined ? undefined : tagKey(tag);
  return cards.filter((card) => {
    if (
      wantedTag !== undefined &&
      !card.tags.some((cardTag) => tagKey(cardTag) === wantedTag)
    ) {
      return false;
    }
    const searched = fold(`${card.cue}\n${card.essence}\n${card.hints}`);
    return words.every((word) => searched.includes(word));
  });
}

export function tagsInUse(cards: Pick<Card, "tags">[]): string[] {
  return uniqueTags(cards.flatMap((card) => card.tags)).sort((a, b) =>
    fold(a).localeCompare(fold(b)),
  );
}

/**
 * Quiz mode asks the Card's Quiz questions in turn. A Card in Quiz mode
 * with no Quiz questions is reviewed in Recall mode.
 */
export function reviewStyle(card: Card): ReviewStyle {
  const { quizQuestions, quizTurn } = card;
  const quizQuestion = quizQuestions[quizTurn % quizQuestions.length];
  return card.quizMode && quizQuestion
    ? { mode: "quiz", quizQuestion }
    : { mode: "recall" };
}

export function createCore({
  clock,
  cards,
  accounts,
  settings,
}: {
  clock: Clock;
  cards: CardStore;
  accounts: AccountStore;
  settings: SettingsStore;
}) {
  /**
   * Runs a step that may switch this device to another account. Cards made
   * before signing in would be stranded on the anonymous account left
   * behind, so they move to the new one, schedules included. A linked
   * account's Cards stay where they are: that account is still reachable.
   */
  async function keepingAnonymousCards<T>(step: () => Promise<T>): Promise<T> {
    const before = await accounts.current();
    const stranded = before.linked ? [] : await cards.list();
    const result = await step();
    const after = await accounts.current();
    if (after.id !== before.id) {
      for (const { id: _, ...card } of stranded) await cards.add(card);
    }
    return result;
  }

  return {
    account(): Promise<Account> {
      return accounts.current();
    },

    async connect(input: SignInMethod): Promise<ConnectResult> {
      let method = input;
      if (method.provider === "email") {
        const email = method.email.trim();
        if (!EMAIL_SHAPE.test(email)) return { ok: false, problem: "email-invalid" };
        method = { provider: "email", email };
      }

      const linked = await accounts.link(method);
      if (linked === "done") return { ok: true, status: "linked" };
      if (linked !== "taken") return { ok: true, status: linked };

      // The identity already has an account, from another device: join it.
      const signedIn = await keepingAnonymousCards(() => accounts.signIn(method));
      return {
        ok: true,
        status: signedIn === "done" ? "signed-in" : signedIn,
      };
    },

    completeEmailLink(link: string): Promise<boolean> {
      return keepingAnonymousCards(() => accounts.completeEmailLink(link));
    },

    deleteAccount(): Promise<void> {
      return accounts.deleteAccount();
    },

    settings(): Promise<Settings> {
      return settings.get();
    },

    changeSettings(changes: Partial<Settings>): Promise<Settings> {
      return settings.update(changes);
    },

    async createCard({ quizMode, ...input }: CardDraft): Promise<CardResult> {
      const checked = checkContent(input);
      if (!checked.ok) return checked;

      const now = clock.now();
      const card = await cards.add({
        ...checked.content,
        quizMode: quizMode ?? (await settings.get()).newCardsInQuizMode,
        quizTurn: 0,
        tags: [],
        archived: false,
        createdAt: now,
        ...(await firstSchedule(now)),
      });
      return { ok: true, card };
    },

    async listCards(): Promise<Card[]> {
      return newestFirst(await cards.list());
    },

    async searchCards(search: CardSearch): Promise<Card[]> {
      return matchingCards(newestFirst(await cards.list()), search);
    },

    setTags(cardId: string, tags: string[]): Promise<Card> {
      const trimmed = tags.map((tag) => tag.trim()).filter((tag) => tag !== "");
      return cards.update(cardId, { tags: uniqueTags(trimmed) });
    },

    /** Changes what the Card says; its schedule and Reviews stay. */
    async editCard(
      cardId: string,
      { quizMode, ...input }: CardDraft,
    ): Promise<CardResult> {
      const checked = checkContent(input);
      if (!checked.ok) return checked;
      const card = await cards.update(cardId, {
        ...checked.content,
        ...(quizMode !== undefined && { quizMode }),
      });
      return { ok: true, card };
    },

    /** Forgets the Card's progress: it is scheduled again as a new Card. */
    async restartLearning(cardId: string): Promise<Card> {
      return cards.update(cardId, await firstSchedule(clock.now()));
    },

    setQuizMode(cardId: string, on: boolean): Promise<Card> {
      return cards.update(cardId, { quizMode: on });
    },

    archiveCard(cardId: string): Promise<Card> {
      return cards.update(cardId, { archived: true });
    },

    /** The Card is due again on the date it had when it was Archived. */
    unarchiveCard(cardId: string): Promise<Card> {
      return cards.update(cardId, { archived: false });
    },

    /** For good: the Card and its Review history are gone. */
    deleteCard(cardId: string): Promise<void> {
      return cards.remove(cardId);
    },

    async dueCards(): Promise<Card[]> {
      const now = clock.now();
      const stored = await cards.list();
      return stored
        .filter((card) => !card.archived && card.dueAt <= now)
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    },

    async recordReview({
      card,
      channel,
      ...answer
    }: { card: Card; channel: ReviewChannel } & ReviewAnswer): Promise<Card> {
      const reviewedAt = clock.now();
      const grade = gradeOf(answer);
      const reviewed = {
        ...card,
        ...(await nextSchedule(card, grade, reviewedAt)),
        // The next Quiz mode Review asks the following Quiz question.
        quizTurn: answer.mode === "quiz" ? card.quizTurn + 1 : card.quizTurn,
      };
      await cards.recordReview(reviewed, {
        cardId: card.id,
        reviewedAt,
        grade,
        channel,
        mode: answer.mode,
      });
      return reviewed;
    },

    listReviews(cardId: string): Promise<Review[]> {
      return cards.listReviews(cardId);
    },
  };
}
