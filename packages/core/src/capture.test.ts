import { describe, expect, it } from "vitest";
import { createCore, type CaptureDraft } from "./index";
import { inMemoryBackend } from "./testing/inMemoryBackend";

async function setup({
  now = "2026-01-15T09:00:00.000Z",
  linked = true,
  captureLimitEnforced,
}: { now?: string; linked?: boolean; captureLimitEnforced?: boolean } = {}) {
  let instant = new Date(now);
  const { cards, accounts, settings, pushTokens } =
    inMemoryBackend().device("alice");
  const core = createCore({
    clock: { now: () => instant },
    cards,
    accounts,
    settings,
    pushTokens,
    ...(captureLimitEnforced !== undefined && {
      features: { captureLimitEnforced },
    }),
  });
  if (linked) await core.connect({ provider: "google" });
  return { core, setNow: (next: string) => (instant = new Date(next)) };
}

const DRAFT: CaptureDraft = {
  cue: "How does nuclear fusion work?",
  essence: "Light nuclei merge into a heavier one and release energy.",
  hints: "Think of the Sun.",
  tags: ["Physics", "energy"],
  quizQuestions: [
    { question: "What merges in fusion?", answer: "Light nuclei" },
  ],
  source: { assistant: "Claude", conversation: "Fusion basics" },
};

describe("Capture", () => {
  it("creates one Card with its Hints, Tags, Quiz questions and Source", async () => {
    const { core } = await setup();

    const result = await core.captureCard(DRAFT);

    expect(result.ok).toBe(true);
    expect(await core.listCards()).toMatchObject([
      {
        cue: DRAFT.cue,
        essence: DRAFT.essence,
        hints: "Think of the Sun.",
        tags: ["Physics", "energy"],
        quizQuestions: [
          { question: "What merges in fusion?", answer: "Light nuclei" },
        ],
        source: { assistant: "Claude", conversation: "Fusion basics" },
      },
    ]);
  });

  it("schedules a Captured Card like a Card created by hand", async () => {
    const { core } = await setup();

    const captured = await core.captureCard(DRAFT);
    const created = await core.createCard({
      cue: "By hand",
      essence: "Typed.",
    });

    if (!captured.ok || !created.ok) throw new Error("Card refused");
    expect(captured.card.dueAt).toEqual(created.card.dueAt);
  });

  it("gives a Card created by hand no Source", async () => {
    const { core } = await setup();

    const created = await core.createCard({
      cue: "By hand",
      essence: "Typed.",
    });

    expect(created).toMatchObject({ ok: true, card: { source: null } });
  });

  it("starts a Captured Card in Quiz mode when the setting says so", async () => {
    const { core } = await setup();
    await core.changeSettings({ newCardsInQuizMode: true });

    const result = await core.captureCard(DRAFT);

    expect(result).toMatchObject({ ok: true, card: { quizMode: true } });
  });

  it("keeps the suggested Tags trimmed and without duplicates", async () => {
    const { core } = await setup();

    const result = await core.captureCard({
      ...DRAFT,
      tags: [" Physics ", "physics", ""],
    });

    expect(result).toMatchObject({ ok: true, card: { tags: ["Physics"] } });
  });

  it("refuses a draft breaking the Cue, Essence or Quiz question limits and saves nothing", async () => {
    const { core } = await setup();

    const result = await core.captureCard({
      ...DRAFT,
      cue: "c".repeat(101),
      essence: "e".repeat(281),
      quizQuestions: Array.from({ length: 4 }, (_, index) => ({
        question: `Question ${index}?`,
        answer: "An answer",
      })),
    });

    expect(result).toEqual({
      ok: false,
      problems: ["cue-too-long", "essence-too-long", "too-many-quiz-questions"],
    });
    expect(await core.listCards()).toEqual([]);
    expect(await core.capturedThisMonth()).toBe(0);
  });

  it("refuses a Source with no assistant or one too long, and saves nothing", async () => {
    const { core } = await setup();

    const result = await core.captureCard({
      ...DRAFT,
      source: { assistant: " ", conversation: "c".repeat(501) },
    });

    expect(result).toEqual({
      ok: false,
      problems: ["source-assistant-missing", "source-conversation-too-long"],
    });
    expect(await core.listCards()).toEqual([]);
  });

  it("refuses a Capture into an anonymous Account", async () => {
    const { core } = await setup({ linked: false });

    const result = await core.captureCard(DRAFT);

    expect(result).toEqual({ ok: false, problems: ["account-not-linked"] });
    expect(await core.listCards()).toEqual([]);
  });
});

describe("the Captured Card count", () => {
  it("counts each Captured Card of the month, not Cards created by hand", async () => {
    const { core } = await setup();

    await core.captureCard(DRAFT);
    await core.captureCard(DRAFT);
    await core.createCard({ cue: "By hand", essence: "Typed." });

    expect(await core.capturedThisMonth()).toBe(2);
  });

  it("still counts a Captured Card once it is deleted", async () => {
    const { core } = await setup();
    const result = await core.captureCard(DRAFT);
    if (!result.ok) throw new Error("Card refused");

    await core.deleteCard(result.card.id);

    expect(await core.capturedThisMonth()).toBe(1);
  });

  it("starts again at zero when a new month begins in the user's time zone", async () => {
    // 23:30 on 31 January in Paris is still January there, but February in UTC.
    const { core, setNow } = await setup({ now: "2026-01-31T22:30:00.000Z" });
    await core.changeSettings({ timeZone: "Europe/Paris" });
    await core.captureCard(DRAFT);

    setNow("2026-01-31T22:59:00.000Z");
    expect(await core.capturedThisMonth()).toBe(1);

    setNow("2026-01-31T23:00:00.000Z");
    expect(await core.capturedThisMonth()).toBe(0);
  });

  it("counts months in UTC until the user has a time zone", async () => {
    const { core, setNow } = await setup({ now: "2026-01-31T23:30:00.000Z" });
    await core.captureCard(DRAFT);

    setNow("2026-02-01T00:00:00.000Z");

    expect(await core.capturedThisMonth()).toBe(0);
  });

  it("does not limit Captures by default", async () => {
    const { core } = await setup();

    for (let count = 0; count < 4; count++) await core.captureCard(DRAFT);

    expect(await core.capturedThisMonth()).toBe(4);
  });

  it("refuses a Capture past the monthly limit once the limit is enforced", async () => {
    const { core } = await setup({ captureLimitEnforced: true });
    for (let count = 0; count < 3; count++) await core.captureCard(DRAFT);

    const result = await core.captureCard(DRAFT);

    expect(result).toEqual({ ok: false, problems: ["capture-limit-reached"] });
    expect(await core.listCards()).toHaveLength(3);
  });
});
