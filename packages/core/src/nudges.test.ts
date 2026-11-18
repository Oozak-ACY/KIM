import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createCore,
  nudgeLanguage,
  nudgeMessage,
  planNudges,
  type SentNudge,
} from "./index";
import { inMemoryBackend } from "./testing/inMemoryBackend";

function setup(now = "2026-01-15T09:00:00.000Z") {
  let instant = new Date(now);
  const backend = inMemoryBackend();
  const device = backend.device("alice");
  const core = createCore({ clock: { now: () => instant }, ...device });
  return {
    core,
    backend,
    clock: () => instant,
    setNow: (next: string) => (instant = new Date(next)),
  };
}

async function create(
  core: ReturnType<typeof setup>["core"],
  cue: string,
) {
  const result = await core.createCard({ cue, essence: "An Essence." });
  if (!result.ok) throw new Error("Card refused");
  return result.card;
}

/** What the Nudge job would plan for this Account right now. */
async function plan(
  { core, clock }: ReturnType<typeof setup>,
  sent: SentNudge[] = [],
) {
  return planNudges({
    linked: (await core.account()).linked,
    cards: await core.listCards(),
    sent,
    now: clock(),
  });
}

async function linkedSetup() {
  const context = setup();
  await context.core.connect({ provider: "google" });
  return context;
}

describe("planning Nudges", () => {
  it("nudges each due Card of a linked Account once, with its Cue", async () => {
    const context = await linkedSetup();
    const card = await create(context.core, "How does nuclear fusion work?");

    expect(await plan(context)).toEqual([
      { cardId: card.id, cue: card.cue, dueAt: card.dueAt },
    ]);
  });

  it("does not nudge a Card that is not due yet", async () => {
    const context = await linkedSetup();
    const card = await create(context.core, "What is KIM?");
    await context.core.recordReview({
      card,
      channel: "app",
      mode: "recall",
      outcome: "remembered",
    });

    expect(await plan(context)).toEqual([]);
  });

  it("nudges a Card once it comes due", async () => {
    const context = await linkedSetup();
    const card = await create(context.core, "What is KIM?");
    const reviewed = await context.core.recordReview({
      card,
      channel: "app",
      mode: "recall",
      outcome: "remembered",
    });

    context.setNow(reviewed.dueAt.toISOString());

    expect(await plan(context)).toEqual([
      { cardId: card.id, cue: card.cue, dueAt: reviewed.dueAt },
    ]);
  });

  it("never nudges a Card twice for the same due date", async () => {
    const context = await linkedSetup();
    const card = await create(context.core, "What is KIM?");
    const sent = await plan(context);

    context.setNow("2026-01-16T09:00:00.000Z");

    expect(await plan(context, sent)).toEqual([]);
  });

  it("nudges a Card again once it is due on a new date", async () => {
    const context = await linkedSetup();
    const card = await create(context.core, "What is KIM?");
    const sent = await plan(context);
    const reviewed = await context.core.recordReview({
      card,
      channel: "app",
      mode: "recall",
      outcome: "forgotten",
    });

    context.setNow(reviewed.dueAt.toISOString());

    expect(await plan(context, sent)).toEqual([
      { cardId: card.id, cue: card.cue, dueAt: reviewed.dueAt },
    ]);
  });

  it("skips a Card reviewed in the meantime, before the job runs", async () => {
    const context = await linkedSetup();
    const reviewedFirst = await create(context.core, "Reviewed in the meantime");
    const leftDue = await create(context.core, "Still due");

    context.setNow("2026-01-15T09:30:00.000Z");
    await context.core.recordReview({
      card: reviewedFirst,
      channel: "app",
      mode: "recall",
      outcome: "remembered",
    });

    expect(await plan(context)).toEqual([
      { cardId: leftDue.id, cue: leftDue.cue, dueAt: leftDue.dueAt },
    ]);
  });

  it("nudges a Card that came due within the last day", async () => {
    const context = await linkedSetup();
    const card = await create(context.core, "What is KIM?");

    context.setNow("2026-01-16T09:00:00.000Z");

    expect(await plan(context)).toEqual([
      { cardId: card.id, cue: card.cue, dueAt: card.dueAt },
    ]);
  });

  it("does not nudge a Card that came due over a day ago, as it is not newly due", async () => {
    const context = await linkedSetup();
    await create(context.core, "What is KIM?");

    context.setNow("2026-01-16T09:00:00.001Z");

    expect(await plan(context)).toEqual([]);
  });

  it("does not nudge an Archived Card", async () => {
    const context = await linkedSetup();
    const card = await create(context.core, "What is KIM?");
    await context.core.archiveCard(card.id);

    expect(await plan(context)).toEqual([]);
  });

  it("sends no Nudges to an anonymous Account", async () => {
    const context = setup();
    await create(context.core, "What is KIM?");

    expect(await plan(context)).toEqual([]);
  });

  it("nudges the Cards due longest first", async () => {
    const context = await linkedSetup();
    const first = await create(context.core, "First");
    context.setNow("2026-01-15T10:00:00.000Z");
    const second = await create(context.core, "Second");

    expect((await plan(context)).map(({ cardId }) => cardId)).toEqual([
      first.id,
      second.id,
    ]);
  });
});

describe("the Nudge text", () => {
  it("asks about the Cue in English", () => {
    expect(nudgeMessage("How does nuclear fusion work?", "en")).toEqual({
      title: "How does nuclear fusion work?",
      body: "Do you still remember it? Time to reinforce it.",
    });
  });

  it("asks about the Cue in French", () => {
    expect(nudgeMessage("Comment fonctionne la fusion nucléaire ?", "fr")).toEqual({
      title: "Comment fonctionne la fusion nucléaire ?",
      body: "Vous en souvenez-vous encore ? C'est le moment de le renforcer.",
    });
  });

  it("speaks the first of the device's languages that KIM speaks", () => {
    expect(nudgeLanguage(["de", "fr", "en"])).toBe("fr");
    expect(nudgeLanguage(["de"])).toBe("en");
  });
});

describe("registering for Nudges", () => {
  it("registers the phone of a linked Account with its language", async () => {
    const { core, backend } = await linkedSetup();

    expect(await core.registerForNudges("ExponentPushToken[abc]", "fr")).toBe(true);
    expect(backend.pushTokens()).toEqual([
      {
        token: "ExponentPushToken[abc]",
        userId: (await core.account()).id,
        language: "fr",
      },
    ]);
  });

  it("registers nothing for an anonymous Account", async () => {
    const { core, backend } = setup();

    expect(await core.registerForNudges("ExponentPushToken[abc]", "en")).toBe(false);
    expect(backend.pushTokens()).toEqual([]);
  });
});

describe("the Nudge job's copy of the planning", () => {
  it("matches the core", () => {
    const read = (path: string) =>
      readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

    expect(read("../../../supabase/functions/_shared/nudges.ts")).toBe(
      read("./nudges.ts"),
    );
  });
});
