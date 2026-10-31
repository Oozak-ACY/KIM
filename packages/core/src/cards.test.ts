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
