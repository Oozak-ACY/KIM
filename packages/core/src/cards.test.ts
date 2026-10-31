import { describe, expect, it } from "vitest";
import { createCore, essenceRoom } from "./index";
import { inMemoryCardStore } from "./testing/inMemoryCardStore";

function setup(now = "2026-01-15T09:00:00.000Z") {
  let instant = new Date(now);
  const core = createCore({
    clock: { now: () => instant },
    cards: inMemoryCardStore(),
  });
  return { core, setNow: (next: string) => (instant = new Date(next)) };
}

describe("creating a Card", () => {
  it("adds a Card with its Cue and Essence to the list of Cards", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "How does nuclear fusion work?",
      essence: "Light nuclei merge into a heavier one and release energy.",
    });

    expect(result.ok).toBe(true);
    expect(await core.listCards()).toMatchObject([
      {
        cue: "How does nuclear fusion work?",
        essence: "Light nuclei merge into a heavier one and release energy.",
        createdAt: new Date("2026-01-15T09:00:00.000Z"),
      },
    ]);
  });

  it("accepts a Cue of 100 characters", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "c".repeat(100),
      essence: "An Essence.",
    });

    expect(result.ok).toBe(true);
  });

  it("refuses a Cue above 100 characters and keeps no Card", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "c".repeat(101),
      essence: "An Essence.",
    });

    expect(result).toEqual({ ok: false, problems: ["cue-too-long"] });
    expect(await core.listCards()).toEqual([]);
  });

  it("accepts an Essence of 280 characters", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "A Cue",
      essence: "e".repeat(280),
    });

    expect(result.ok).toBe(true);
  });

  it("refuses an Essence above 280 characters", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "A Cue",
      essence: "e".repeat(281),
    });

    expect(result).toEqual({ ok: false, problems: ["essence-too-long"] });
  });

  it("counts an emoji as one character", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "A Cue",
      essence: "🧠".repeat(280),
    });

    expect(result.ok).toBe(true);
  });

  it("accepts an Essence of 3 bullet lines, ignoring blank lines", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "A Cue",
      essence: "- one\n\n- two\n- three\n",
    });

    expect(result.ok).toBe(true);
  });

  it("refuses an Essence of more than 3 bullet lines", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "A Cue",
      essence: "- one\n- two\n- three\n- four",
    });

    expect(result).toEqual({ ok: false, problems: ["essence-too-many-lines"] });
  });

  it("refuses a blank Cue and a blank Essence", async () => {
    const { core } = setup();

    const result = await core.createCard({ cue: "  ", essence: "\n" });

    expect(result).toEqual({
      ok: false,
      problems: ["cue-missing", "essence-missing"],
    });
  });

  it("reports every problem at once", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "c".repeat(101),
      essence: "e".repeat(281),
    });

    expect(result).toEqual({
      ok: false,
      problems: ["cue-too-long", "essence-too-long"],
    });
  });

  it("never rewrites the Essence", async () => {
    const { core } = setup();
    const essence = "  - keeps its spacing  \n\n- and its blank line\n";

    await core.createCard({ cue: "A Cue", essence });

    expect((await core.listCards())[0]?.essence).toBe(essence);
  });
});

describe("listing Cards", () => {
  it("shows the newest Card first", async () => {
    const { core, setNow } = setup();
    await core.createCard({ cue: "First", essence: "An Essence." });
    setNow("2026-01-16T09:00:00.000Z");
    await core.createCard({ cue: "Second", essence: "An Essence." });

    const cards = await core.listCards();

    expect(cards.map((card) => card.cue)).toEqual(["Second", "First"]);
  });
});

describe("due Cards", () => {
  it("gives a new Card its first due date", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "A Cue",
      essence: "An Essence.",
    });

    expect(result).toMatchObject({
      ok: true,
      card: { dueAt: new Date("2026-01-15T09:00:00.000Z") },
    });
  });

  it("lists the Cards due now, longest overdue first", async () => {
    const { core, setNow } = setup();
    await core.createCard({ cue: "First", essence: "An Essence." });
    setNow("2026-01-16T09:00:00.000Z");
    await core.createCard({ cue: "Second", essence: "An Essence." });

    const due = await core.dueCards();

    expect(due.map((card) => card.cue)).toEqual(["First", "Second"]);
  });

  it("lists nothing when there are no Cards", async () => {
    const { core } = setup();

    expect(await core.dueCards()).toEqual([]);
  });
});

describe("reviewing a Card in Recall mode", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function newCard(core: ReturnType<typeof setup>["core"]) {
    const result = await core.createCard({
      cue: "A Cue",
      essence: "An Essence.",
    });
    if (!result.ok) throw new Error("the Card should be valid");
    return result.card;
  }

  it("takes a remembered Card off the due list until its next due date", async () => {
    const { core, setNow } = setup();
    const card = await newCard(core);

    const reviewed = await core.recordReview({
      card,
      mode: "recall",
      outcome: "remembered",
      channel: "app",
    });

    expect(await core.dueCards()).toEqual([]);
    setNow(reviewed.dueAt.toISOString());
    expect((await core.dueCards()).map(({ id }) => id)).toEqual([card.id]);
  });

  it("shows the next due date on the listed Card", async () => {
    const { core } = setup();
    const card = await newCard(core);

    const reviewed = await core.recordReview({
      card,
      mode: "recall",
      outcome: "remembered",
      channel: "app",
    });

    const [listed] = await core.listCards();
    expect(listed?.dueAt).toEqual(reviewed.dueAt);
    expect(listed?.dueAt.getTime()).toBeGreaterThan(card.dueAt.getTime());
  });

  it("brings a Card back less and less often while it is remembered", async () => {
    const { core, setNow } = setup();
    let card = await newCard(core);

    const gaps: number[] = [];
    for (let review = 0; review < 5; review++) {
      setNow(card.dueAt.toISOString());
      const reviewed = await core.recordReview({
        card,
        mode: "recall",
        outcome: "remembered",
        channel: "app",
      });
      gaps.push(reviewed.dueAt.getTime() - card.dueAt.getTime());
      card = reviewed;
    }

    expect(gaps[0]).toBeGreaterThanOrEqual(DAY);
    gaps.slice(1).forEach((gap, index) => {
      expect(gap).toBeGreaterThan(gaps[index] as number);
    });
  });

  it("brings a forgotten Card back sooner than a remembered one", async () => {
    const { core } = setup();
    const card = await newCard(core);
    const other = await newCard(core);

    const forgotten = await core.recordReview({
      card,
      mode: "recall",
      outcome: "forgotten",
      channel: "app",
    });
    const remembered = await core.recordReview({
      card: other,
      mode: "recall",
      outcome: "remembered",
      channel: "app",
    });

    expect(forgotten.dueAt.getTime()).toBeLessThan(remembered.dueAt.getTime());
  });

  it("shortens the wait when a well-known Card is forgotten", async () => {
    const { core, setNow } = setup();
    let card = await newCard(core);
    for (let review = 0; review < 3; review++) {
      setNow(card.dueAt.toISOString());
      card = await core.recordReview({
        card,
        mode: "recall",
        outcome: "remembered",
        channel: "app",
      });
    }
    setNow(card.dueAt.toISOString());
    const reviewedAt = card.dueAt.getTime();

    const forgotten = await core.recordReview({
      card,
      mode: "recall",
      outcome: "forgotten",
      channel: "app",
    });

    expect(forgotten.dueAt.getTime() - reviewedAt).toBeLessThan(DAY);
  });

  it('records "I remembered" as Good', async () => {
    const { core } = setup();
    const card = await newCard(core);

    await core.recordReview({
      card,
      mode: "recall",
      outcome: "remembered",
      channel: "app",
    });

    expect(await core.listReviews(card.id)).toEqual([
      {
        cardId: card.id,
        reviewedAt: new Date("2026-01-15T09:00:00.000Z"),
        grade: "good",
        channel: "app",
        mode: "recall",
      },
    ]);
  });

  it(`records "I'd forgotten" as Again`, async () => {
    const { core, setNow } = setup();
    const card = await newCard(core);
    setNow("2026-01-15T10:30:00.000Z");

    await core.recordReview({
      card,
      mode: "recall",
      outcome: "forgotten",
      channel: "app",
    });

    expect(await core.listReviews(card.id)).toEqual([
      {
        cardId: card.id,
        reviewedAt: new Date("2026-01-15T10:30:00.000Z"),
        grade: "again",
        channel: "app",
        mode: "recall",
      },
    ]);
  });
});

describe("room left in the Essence", () => {
  it("starts with the full allowance", () => {
    expect(essenceRoom("")).toEqual({ characters: 280, lines: 3 });
  });

  it("shrinks while typing", () => {
    expect(essenceRoom("- one\n- two")).toEqual({ characters: 269, lines: 1 });
  });

  it("goes negative past the limits", () => {
    expect(essenceRoom("a\nb\nc\nd" + "e".repeat(280))).toEqual({
      characters: -7,
      lines: -1,
    });
  });
});
