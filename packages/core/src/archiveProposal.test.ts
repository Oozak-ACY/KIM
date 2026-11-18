import { describe, expect, it } from "vitest";
import { createCore, type Card } from "./index";
import { inMemoryBackend } from "./testing/inMemoryBackend";

function setup() {
  let instant = new Date("2026-01-15T09:00:00.000Z");
  const { cards, accounts, settings, pushTokens } =
    inMemoryBackend().device("alice");
  const core = createCore({
    clock: { now: () => instant },
    cards,
    accounts,
    settings,
    pushTokens,
  });
  return { core, setNow: (next: Date) => (instant = next) };
}

type Context = ReturnType<typeof setup>;

async function newCard({ core }: Context, quizMode = false): Promise<Card> {
  const result = await core.createCard({
    cue: "How does nuclear fusion work?",
    essence: "Light nuclei merge into a heavier one and release energy.",
    quizQuestions: [{ question: "What merges?", answer: "Light nuclei" }],
    quizMode,
  });
  if (!result.ok) throw new Error("Card refused");
  return result.card;
}

const DAY = 24 * 60 * 60 * 1000;

function intervalDays(card: Card): number {
  const lastReviewAt = new Date(card.schedule.lastReviewAt as string);
  return (card.dueAt.getTime() - lastReviewAt.getTime()) / DAY;
}

/** Remembers the Card on each due date until its next interval is that long. */
async function rememberUntilInterval(
  context: Context,
  card: Card,
  days: number,
): Promise<Card> {
  let reviewed = card;
  do {
    context.setNow(reviewed.dueAt);
    reviewed = await context.core.recordReview({
      card: reviewed,
      channel: "app",
      mode: "recall",
      outcome: "remembered",
    });
  } while (intervalDays(reviewed) < days);
  return reviewed;
}

describe("the archive proposal", () => {
  it("is made when the user remembers a Card at the end of a six month interval", async () => {
    const context = setup();
    const card = await rememberUntilInterval(context, await newCard(context), 180);
    context.setNow(card.dueAt);

    const reviewed = await context.core.recordReview({
      card,
      channel: "app",
      mode: "recall",
      outcome: "remembered",
    });

    expect(reviewed.archiveProposed).toBe(true);
  });

  /** The Card as if its last Review had scheduled it that many days ahead. */
  function withInterval(card: Card, days: number): Card {
    const lastReviewAt = new Date(card.schedule.lastReviewAt as string);
    return { ...card, dueAt: new Date(lastReviewAt.getTime() + days * DAY) };
  }

  it.each([
    [180, true],
    [179, false],
  ])("closing an interval of %i days proposes: %s", async (days, proposed) => {
    const context = setup();
    const remembered = await rememberUntilInterval(
      context,
      await newCard(context),
      180,
    );
    const card = withInterval(remembered, days);
    context.setNow(card.dueAt);

    const reviewed = await context.core.recordReview({
      card,
      channel: "app",
      mode: "recall",
      outcome: "remembered",
    });

    expect(reviewed.archiveProposed).toBe(proposed);
  });

  it("is not made for a remembered Review closing a shorter interval", async () => {
    const context = setup();
    const card = await newCard(context);
    context.setNow(card.dueAt);

    const reviewed = await context.core.recordReview({
      card,
      channel: "app",
      mode: "recall",
      outcome: "remembered",
    });

    expect(reviewed.archiveProposed).toBe(false);
  });

  it("is not made when the user had forgotten the Card", async () => {
    const context = setup();
    const card = await rememberUntilInterval(context, await newCard(context), 180);
    context.setNow(card.dueAt);

    const reviewed = await context.core.recordReview({
      card,
      channel: "app",
      mode: "recall",
      outcome: "forgotten",
    });

    expect(reviewed.archiveProposed).toBe(false);
  });

  it.each([
    ["good", true],
    ["hard", true],
    ["forgot", false],
  ] as const)(
    "in Quiz mode, answering %s proposes: %s",
    async (outcome, proposed) => {
      const context = setup();
      const card = await rememberUntilInterval(
        context,
        await newCard(context, true),
        180,
      );
      context.setNow(card.dueAt);

      const reviewed = await context.core.recordReview({
        card,
        channel: "app",
        mode: "quiz",
        outcome,
      });

      expect(reviewed.archiveProposed).toBe(proposed);
    },
  );

  async function proposedCard(context: Context): Promise<Card> {
    const card = await rememberUntilInterval(context, await newCard(context), 180);
    context.setNow(card.dueAt);
    const reviewed = await context.core.recordReview({
      card,
      channel: "app",
      mode: "recall",
      outcome: "remembered",
    });
    if (!reviewed.archiveProposed) throw new Error("No archive proposal");
    return reviewed;
  }

  it("archives the Card once accepted, so it is no longer due", async () => {
    const context = setup();
    const card = await proposedCard(context);

    await context.core.archiveCard(card.id);

    expect(await context.core.listCards()).toMatchObject([
      { id: card.id, archived: true },
    ]);
    context.setNow(card.dueAt);
    expect(await context.core.dueCards()).toEqual([]);
  });

  it("keeps the Card scheduled once declined, and is never made again", async () => {
    const context = setup();
    const card = await proposedCard(context);

    await context.core.declineArchiveProposal(card.id);

    expect(await context.core.listCards()).toMatchObject([
      { id: card.id, archived: false, dueAt: card.dueAt },
    ]);
    context.setNow(card.dueAt);
    const [due] = await context.core.dueCards();
    if (!due) throw new Error("The Card is not due");
    const reviewedAgain = await context.core.recordReview({
      card: due,
      channel: "app",
      mode: "recall",
      outcome: "remembered",
    });
    expect(reviewedAgain.archiveProposed).toBe(false);
  });
});
