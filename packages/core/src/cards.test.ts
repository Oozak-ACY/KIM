import { describe, expect, it } from "vitest";
import {
  createCore,
  essenceRoom,
  matchingCards,
  reviewStyle,
  tagsInUse,
} from "./index";
import { inMemoryBackend } from "./testing/inMemoryBackend";

function setup(now = "2026-01-15T09:00:00.000Z") {
  let instant = new Date(now);
  const { cards, accounts, settings } = inMemoryBackend().device("alice");
  const core = createCore({
    clock: { now: () => instant },
    cards,
    accounts,
    settings,
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

describe("tagging a Card", () => {
  async function newCard(core: ReturnType<typeof setup>["core"]) {
    const result = await core.createCard({
      cue: "A Cue",
      essence: "An Essence.",
    });
    if (!result.ok) throw new Error("the Card should be valid");
    return result.card;
  }

  it("starts a Card without Tags", async () => {
    const { core } = setup();

    const card = await newCard(core);

    expect(card.tags).toEqual([]);
  });

  it("adds Tags to a Card", async () => {
    const { core } = setup();
    const card = await newCard(core);

    await core.setTags(card.id, ["physics", "energy"]);

    expect((await core.listCards())[0]?.tags).toEqual(["physics", "energy"]);
  });

  it("removes a Tag from a Card", async () => {
    const { core } = setup();
    const card = await newCard(core);
    await core.setTags(card.id, ["physics", "energy"]);

    await core.setTags(card.id, ["energy"]);

    expect((await core.listCards())[0]?.tags).toEqual(["energy"]);
  });

  it("returns the tagged Card", async () => {
    const { core } = setup();
    const card = await newCard(core);

    const tagged = await core.setTags(card.id, ["physics"]);

    expect(tagged).toMatchObject({ id: card.id, tags: ["physics"] });
  });

  it("keeps the schedule of a Card when its Tags change", async () => {
    const { core } = setup();
    const card = await newCard(core);
    const reviewed = await core.recordReview({
      card,
      mode: "recall",
      outcome: "remembered",
      channel: "app",
    });

    const tagged = await core.setTags(card.id, ["physics"]);

    expect(tagged.dueAt).toEqual(reviewed.dueAt);
    expect(tagged.schedule).toEqual(reviewed.schedule);
  });

  it("trims Tags and drops blank ones", async () => {
    const { core } = setup();
    const card = await newCard(core);

    const tagged = await core.setTags(card.id, ["  physics ", "   "]);

    expect(tagged.tags).toEqual(["physics"]);
  });

  it("keeps one Tag when the same Tag is given twice in another case", async () => {
    const { core } = setup();
    const card = await newCard(core);

    const tagged = await core.setTags(card.id, ["Physics", "physics"]);

    expect(tagged.tags).toEqual(["Physics"]);
  });

  it("keeps Tags that only differ by an accent apart", async () => {
    const { core } = setup();
    const card = await newCard(core);

    const tagged = await core.setTags(card.id, ["pêche", "péché", "peche"]);

    expect(tagged.tags).toEqual(["pêche", "péché", "peche"]);
    expect(await core.searchCards({ tag: "peche" })).toHaveLength(1);
    expect(tagsInUse([tagged])).toHaveLength(3);
  });
});

describe("searching Cards", () => {
  async function fusionAndGravity(core: ReturnType<typeof setup>["core"]) {
    const fusion = await core.createCard({
      cue: "How does nuclear fusion work?",
      essence: "Light nuclei merge and release énergie.",
    });
    const gravity = await core.createCard({
      cue: "What is gravity?",
      essence: "Mass curves spacetime.",
    });
    if (!fusion.ok || !gravity.ok) throw new Error("the Cards should be valid");
    await core.setTags(fusion.card.id, ["Physics", "Energy"]);
    await core.setTags(gravity.card.id, ["physics"]);
  }

  async function cuesFound(
    core: ReturnType<typeof setup>["core"],
    search: { text?: string; tag?: string },
  ) {
    return (await core.searchCards(search)).map((card) => card.cue);
  }

  it("finds a Card by a word of its Cue", async () => {
    const { core } = setup();
    await fusionAndGravity(core);

    expect(await cuesFound(core, { text: "gravity" })).toEqual([
      "What is gravity?",
    ]);
  });

  it("finds a Card by a word of its Essence", async () => {
    const { core } = setup();
    await fusionAndGravity(core);

    expect(await cuesFound(core, { text: "spacetime" })).toEqual([
      "What is gravity?",
    ]);
  });

  it("ignores case and accents", async () => {
    const { core } = setup();
    await fusionAndGravity(core);

    expect(await cuesFound(core, { text: "ENERGIE" })).toEqual([
      "How does nuclear fusion work?",
    ]);
  });

  it("needs every word, wherever each one is on the Card", async () => {
    const { core } = setup();
    await fusionAndGravity(core);

    expect(await cuesFound(core, { text: "fusion merge" })).toEqual([
      "How does nuclear fusion work?",
    ]);
    expect(await cuesFound(core, { text: "fusion spacetime" })).toEqual([]);
  });

  it("finds nothing when no Card matches", async () => {
    const { core } = setup();
    await fusionAndGravity(core);

    expect(await cuesFound(core, { text: "botany" })).toEqual([]);
  });

  it("filters by one Tag, ignoring case", async () => {
    const { core } = setup();
    await fusionAndGravity(core);

    expect(await cuesFound(core, { tag: "energy" })).toEqual([
      "How does nuclear fusion work?",
    ]);
  });

  it("combines a Tag with text", async () => {
    const { core } = setup();
    await fusionAndGravity(core);

    expect(await cuesFound(core, { tag: "physics", text: "mass" })).toEqual([
      "What is gravity?",
    ]);
    expect(await cuesFound(core, { tag: "energy", text: "mass" })).toEqual([]);
  });

  it("shows the newest Card first", async () => {
    const { core, setNow } = setup();
    await core.createCard({ cue: "Old fusion", essence: "An Essence." });
    setNow("2026-01-16T09:00:00.000Z");
    await core.createCard({ cue: "New fusion", essence: "An Essence." });

    expect(await cuesFound(core, { text: "fusion" })).toEqual([
      "New fusion",
      "Old fusion",
    ]);
  });

  it("returns every Card when the text is blank and no Tag is chosen", async () => {
    const { core } = setup();
    await fusionAndGravity(core);

    expect(await cuesFound(core, { text: "  " })).toHaveLength(2);
  });
});

describe("matching Cards already loaded", () => {
  it("keeps the order it is given", async () => {
    const { core } = setup();
    await core.createCard({ cue: "First fusion", essence: "An Essence." });
    await core.createCard({ cue: "Second fusion", essence: "An Essence." });
    await core.createCard({ cue: "Gravity", essence: "An Essence." });
    const [gravity, second, first] = await core.listCards();
    if (!gravity || !second || !first) throw new Error("three Cards expected");

    const matching = matchingCards([first, gravity, second], {
      text: "fusion",
    });

    expect(matching.map((card) => card.cue)).toEqual([
      "First fusion",
      "Second fusion",
    ]);
  });
});

describe("the Tags in use", () => {
  it("lists each Tag once, in alphabetical order", () => {
    const cards = [{ tags: ["physics", "Énergie"] }, { tags: ["Physics"] }];

    expect(tagsInUse(cards)).toEqual(["Énergie", "physics"]);
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

async function validCard(
  core: ReturnType<typeof setup>["core"],
  input: { cue?: string; essence?: string; hints?: string } = {},
) {
  const result = await core.createCard({
    cue: "A Cue",
    essence: "An Essence.",
    ...input,
  });
  if (!result.ok) throw new Error("the Card should be valid");
  return result.card;
}

describe("Hints", () => {
  it("starts a Card without Hints", async () => {
    const { core } = setup();

    const card = await validCard(core);

    expect(card.hints).toBe("");
  });

  it("keeps the Hints given with a new Card", async () => {
    const { core } = setup();

    await validCard(core, { hints: "Think of the Sun." });

    expect((await core.listCards())[0]?.hints).toBe("Think of the Sun.");
  });

  it("accepts Hints of 280 characters", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "A Cue",
      essence: "An Essence.",
      hints: "h".repeat(280),
    });

    expect(result.ok).toBe(true);
  });

  it("refuses Hints above 280 characters", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "A Cue",
      essence: "An Essence.",
      hints: "h".repeat(281),
    });

    expect(result).toEqual({ ok: false, problems: ["hints-too-long"] });
  });

  it("finds a Card by a word of its Hints", async () => {
    const { core } = setup();
    await validCard(core, { cue: "Fusion", hints: "Think of the Sun." });
    await validCard(core, { cue: "Gravity" });

    const found = await core.searchCards({ text: "sun" });

    expect(found.map((card) => card.cue)).toEqual(["Fusion"]);
  });
});

describe("editing a Card", () => {
  it("changes the Cue, Essence and Hints", async () => {
    const { core } = setup();
    const card = await validCard(core);

    await core.editCard(card.id, {
      cue: "A new Cue",
      essence: "A new Essence.",
      hints: "A new Hint.",
    });

    expect(await core.listCards()).toMatchObject([
      { cue: "A new Cue", essence: "A new Essence.", hints: "A new Hint." },
    ]);
  });

  it("keeps the schedule and the next due date", async () => {
    const { core, setNow } = setup();
    const card = await validCard(core);
    const reviewed = await core.recordReview({
      card,
      mode: "recall",
      outcome: "remembered",
      channel: "app",
    });
    setNow("2026-01-16T12:00:00.000Z");

    const result = await core.editCard(card.id, {
      cue: "A new Cue",
      essence: "A new Essence.",
    });

    expect(result).toMatchObject({
      ok: true,
      card: { dueAt: reviewed.dueAt, schedule: reviewed.schedule },
    });
    const [listed] = await core.listCards();
    expect(listed?.dueAt).toEqual(reviewed.dueAt);
    expect(listed?.schedule).toEqual(reviewed.schedule);
  });

  it("keeps the Tags and the Review history", async () => {
    const { core } = setup();
    const card = await validCard(core);
    await core.setTags(card.id, ["physics"]);
    await core.recordReview({
      card,
      mode: "recall",
      outcome: "remembered",
      channel: "app",
    });

    await core.editCard(card.id, { cue: "A new Cue", essence: "An Essence." });

    expect((await core.listCards())[0]?.tags).toEqual(["physics"]);
    expect(await core.listReviews(card.id)).toHaveLength(1);
  });

  it("removes the Hints when they are left out", async () => {
    const { core } = setup();
    const card = await validCard(core, { hints: "A Hint." });

    await core.editCard(card.id, { cue: "A Cue", essence: "An Essence." });

    expect((await core.listCards())[0]?.hints).toBe("");
  });

  it("refuses an edit past the limits and keeps the Card as it was", async () => {
    const { core } = setup();
    const card = await validCard(core);

    const result = await core.editCard(card.id, {
      cue: "",
      essence: "e".repeat(281),
      hints: "h".repeat(281),
    });

    expect(result).toEqual({
      ok: false,
      problems: ["cue-missing", "essence-too-long", "hints-too-long"],
    });
    expect((await core.listCards())[0]).toEqual(card);
  });
});

describe("restarting learning", () => {
  it("makes the Card due now", async () => {
    const { core, setNow } = setup();
    let card = await validCard(core);
    for (let review = 0; review < 3; review++) {
      setNow(card.dueAt.toISOString());
      card = await core.recordReview({
        card,
        mode: "recall",
        outcome: "remembered",
        channel: "app",
      });
    }
    setNow("2026-03-01T08:00:00.000Z");

    const restarted = await core.restartLearning(card.id);

    expect(restarted.dueAt).toEqual(new Date("2026-03-01T08:00:00.000Z"));
    expect((await core.dueCards()).map(({ id }) => id)).toContain(card.id);
  });

  it("brings the Card back as soon as a new Card once remembered again", async () => {
    const { core, setNow } = setup();
    let card = await validCard(core);
    for (let review = 0; review < 3; review++) {
      setNow(card.dueAt.toISOString());
      card = await core.recordReview({
        card,
        mode: "recall",
        outcome: "remembered",
        channel: "app",
      });
    }
    setNow("2026-03-01T08:00:00.000Z");
    const fresh = await validCard(core);
    const restarted = await core.restartLearning(card.id);

    const [again, firstTime] = [
      await core.recordReview({
        card: restarted,
        mode: "recall",
        outcome: "remembered",
        channel: "app",
      }),
      await core.recordReview({
        card: fresh,
        mode: "recall",
        outcome: "remembered",
        channel: "app",
      }),
    ];

    expect(again.dueAt).toEqual(firstTime.dueAt);
  });

  it("keeps what the Card says and its Review history", async () => {
    const { core } = setup();
    const card = await validCard(core, { hints: "A Hint." });
    await core.setTags(card.id, ["physics"]);
    await core.recordReview({
      card,
      mode: "recall",
      outcome: "remembered",
      channel: "app",
    });

    const restarted = await core.restartLearning(card.id);

    expect(restarted).toMatchObject({
      cue: "A Cue",
      essence: "An Essence.",
      hints: "A Hint.",
      tags: ["physics"],
    });
    expect(await core.listReviews(card.id)).toHaveLength(1);
  });
});

describe("archiving a Card", () => {
  it("starts a Card unarchived", async () => {
    const { core } = setup();

    const card = await validCard(core);

    expect(card.archived).toBe(false);
  });

  it("is never due once Archived", async () => {
    const { core, setNow } = setup();
    const card = await validCard(core);

    await core.archiveCard(card.id);

    expect(await core.dueCards()).toEqual([]);
    setNow("2027-01-15T09:00:00.000Z");
    expect(await core.dueCards()).toEqual([]);
  });

  it("stays in the list and in search once Archived", async () => {
    const { core } = setup();
    const card = await validCard(core, { cue: "Fusion" });

    await core.archiveCard(card.id);

    expect(await core.listCards()).toMatchObject([{ id: card.id, archived: true }]);
    expect((await core.searchCards({ text: "fusion" })).map(({ id }) => id)).toEqual([
      card.id,
    ]);
  });

  it("comes back into scheduling once unarchived", async () => {
    const { core, setNow } = setup();
    const card = await validCard(core);
    const reviewed = await core.recordReview({
      card,
      mode: "recall",
      outcome: "remembered",
      channel: "app",
    });
    await core.archiveCard(card.id);

    const unarchived = await core.unarchiveCard(card.id);

    expect(unarchived).toMatchObject({
      archived: false,
      dueAt: reviewed.dueAt,
      schedule: reviewed.schedule,
    });
    expect(await core.dueCards()).toEqual([]);
    setNow(reviewed.dueAt.toISOString());
    expect((await core.dueCards()).map(({ id }) => id)).toEqual([card.id]);
  });
});

describe("deleting a Card", () => {
  it("removes the Card and its Review history, and nothing else", async () => {
    const { core } = setup();
    const card = await validCard(core, { cue: "Doomed" });
    const kept = await validCard(core, { cue: "Kept" });
    for (const reviewed of [card, kept]) {
      await core.recordReview({
        card: reviewed,
        mode: "recall",
        outcome: "remembered",
        channel: "app",
      });
    }

    await core.deleteCard(card.id);

    expect((await core.listCards()).map(({ cue }) => cue)).toEqual(["Kept"]);
    expect(await core.listReviews(card.id)).toEqual([]);
    expect(await core.listReviews(kept.id)).toHaveLength(1);
  });
});

describe("Quiz questions", () => {
  const question = (n: number) => ({
    question: `Question ${n}?`,
    answer: `Answer ${n}.`,
  });

  it("starts a Card without Quiz questions", async () => {
    const { core } = setup();

    const result = await core.createCard({ cue: "A Cue", essence: "An Essence." });

    expect(result).toMatchObject({ ok: true, card: { quizQuestions: [] } });
  });

  it("keeps up to 3 Quiz questions with their expected answers", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "A Cue",
      essence: "An Essence.",
      quizQuestions: [question(1), question(2), question(3)],
    });

    expect(result).toMatchObject({
      ok: true,
      card: { quizQuestions: [question(1), question(2), question(3)] },
    });
  });

  it("refuses a fourth Quiz question and keeps no Card", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "A Cue",
      essence: "An Essence.",
      quizQuestions: [question(1), question(2), question(3), question(4)],
    });

    expect(result).toEqual({ ok: false, problems: ["too-many-quiz-questions"] });
    expect(await core.listCards()).toEqual([]);
  });

  it("refuses a Quiz question without its question or its answer", async () => {
    const { core } = setup();

    const result = await core.createCard({
      cue: "A Cue",
      essence: "An Essence.",
      quizQuestions: [{ question: " ", answer: "" }],
    });

    expect(result).toEqual({
      ok: false,
      problems: ["quiz-question-missing", "quiz-answer-missing"],
    });
  });

  it("adds, edits and removes Quiz questions when the Card is edited", async () => {
    const { core } = setup();
    const created = await core.createCard({
      cue: "A Cue",
      essence: "An Essence.",
      quizQuestions: [question(1), question(2)],
    });
    if (!created.ok) throw new Error("the Card should be valid");

    const edited = await core.editCard(created.card.id, {
      cue: "A Cue",
      essence: "An Essence.",
      quizQuestions: [{ question: "Edited?", answer: "Yes." }, question(3)],
    });

    expect(edited).toMatchObject({
      ok: true,
      card: {
        quizQuestions: [{ question: "Edited?", answer: "Yes." }, question(3)],
      },
    });
  });

  it("refuses an edit to a fourth Quiz question and keeps the Card as it was", async () => {
    const { core } = setup();
    const created = await core.createCard({
      cue: "A Cue",
      essence: "An Essence.",
      quizQuestions: [question(1), question(2), question(3)],
    });
    if (!created.ok) throw new Error("the Card should be valid");

    const edited = await core.editCard(created.card.id, {
      cue: "A Cue",
      essence: "An Essence.",
      quizQuestions: [question(1), question(2), question(3), question(4)],
    });

    expect(edited).toEqual({ ok: false, problems: ["too-many-quiz-questions"] });
    expect((await core.listCards())[0]?.quizQuestions).toHaveLength(3);
  });
});

describe("Quiz mode", () => {
  const QUESTIONS = [
    { question: "Question 1?", answer: "Answer 1." },
    { question: "Question 2?", answer: "Answer 2." },
    { question: "Question 3?", answer: "Answer 3." },
  ];

  async function quizCard(
    core: ReturnType<typeof setup>["core"],
    quizQuestions = QUESTIONS,
  ) {
    const result = await core.createCard({
      cue: "A Cue",
      essence: "An Essence.",
      quizQuestions,
    });
    if (!result.ok) throw new Error("the Card should be valid");
    return core.setQuizMode(result.card.id, true);
  }

  it("starts a Card in Recall mode", async () => {
    const { core } = setup();

    const result = await core.createCard({ cue: "A Cue", essence: "An Essence." });

    expect(result).toMatchObject({ ok: true, card: { quizMode: false } });
  });

  it("turns Quiz mode on and off for one Card", async () => {
    const { core } = setup();
    const card = await quizCard(core);

    expect(card.quizMode).toBe(true);
    expect((await core.listCards())[0]?.quizMode).toBe(true);
    expect((await core.setQuizMode(card.id, false)).quizMode).toBe(false);
  });

  it("reviews a Card in Recall mode by its Cue while Quiz mode is off", async () => {
    const { core } = setup();
    const result = await core.createCard({
      cue: "A Cue",
      essence: "An Essence.",
      quizQuestions: QUESTIONS,
    });
    if (!result.ok) throw new Error("the Card should be valid");

    expect(reviewStyle(result.card)).toEqual({ mode: "recall" });
  });

  it("asks a Quiz question in Quiz mode", async () => {
    const { core } = setup();
    const card = await quizCard(core);

    expect(reviewStyle(card)).toEqual({
      mode: "quiz",
      quizQuestion: QUESTIONS[0],
    });
  });

  it("falls back to Recall mode when the Card has no Quiz questions", async () => {
    const { core } = setup();
    const card = await quizCard(core, []);

    expect(reviewStyle(card)).toEqual({ mode: "recall" });
  });

  it.each([
    ["forgot", "again"],
    ["hard", "hard"],
    ["good", "good"],
  ] as const)('records "%s" as %s', async (outcome, grade) => {
    const { core } = setup();
    const card = await quizCard(core);

    await core.recordReview({ card, mode: "quiz", outcome, channel: "app" });

    expect(await core.listReviews(card.id)).toEqual([
      {
        cardId: card.id,
        reviewedAt: new Date("2026-01-15T09:00:00.000Z"),
        grade,
        channel: "app",
        mode: "quiz",
      },
    ]);
  });

  it("brings a Card graded Hard back sooner than one graded Good", async () => {
    const { core } = setup();
    const card = await quizCard(core);
    const other = await quizCard(core);

    const hard = await core.recordReview({
      card,
      mode: "quiz",
      outcome: "hard",
      channel: "app",
    });
    const good = await core.recordReview({
      card: other,
      mode: "quiz",
      outcome: "good",
      channel: "app",
    });

    expect(hard.dueAt.getTime()).toBeLessThan(good.dueAt.getTime());
  });

  it("rotates through the Quiz questions across Reviews", async () => {
    const { core } = setup();
    let card = await quizCard(core);

    const asked: string[] = [];
    for (let review = 0; review < 4; review++) {
      const style = reviewStyle(card);
      if (style.mode !== "quiz") throw new Error("the Card is in Quiz mode");
      asked.push(style.quizQuestion.question);
      await core.recordReview({ card, mode: "quiz", outcome: "good", channel: "app" });
      [card] = (await core.listCards()) as [typeof card];
    }

    expect(asked).toEqual([
      "Question 1?",
      "Question 2?",
      "Question 3?",
      "Question 1?",
    ]);
  });

  it("keeps rotating when Quiz questions are removed", async () => {
    const { core } = setup();
    let card = await quizCard(core);
    for (let review = 0; review < 2; review++) {
      card = await core.recordReview({ card, mode: "quiz", outcome: "good", channel: "app" });
    }

    const edited = await core.editCard(card.id, {
      cue: "A Cue",
      essence: "An Essence.",
      quizQuestions: QUESTIONS.slice(0, 2),
    });
    if (!edited.ok) throw new Error("the edit should be valid");

    expect(reviewStyle(edited.card)).toEqual({
      mode: "quiz",
      quizQuestion: QUESTIONS[0],
    });
  });

  it("does not move the rotation with a Recall mode Review", async () => {
    const { core } = setup();
    const card = await quizCard(core, QUESTIONS.slice(0, 2));
    const recalled = await core.setQuizMode(card.id, false);

    await core.recordReview({
      card: recalled,
      mode: "recall",
      outcome: "remembered",
      channel: "app",
    });
    const [listed] = await core.listCards();
    if (!listed) throw new Error("the Card should be listed");

    expect(reviewStyle({ ...listed, quizMode: true })).toEqual({
      mode: "quiz",
      quizQuestion: QUESTIONS[0],
    });
  });
});

describe("the setting for new Cards to start in Quiz mode", () => {
  const CARD = { cue: "A Cue", essence: "An Essence." };

  it("is off by default", async () => {
    const { core } = setup();

    expect(await core.settings()).toEqual({ newCardsInQuizMode: false });
  });

  it("starts new Cards in Quiz mode once turned on", async () => {
    const { core } = setup();

    await core.changeSettings({ newCardsInQuizMode: true });
    const result = await core.createCard(CARD);

    expect(await core.settings()).toEqual({ newCardsInQuizMode: true });
    expect(result).toMatchObject({ ok: true, card: { quizMode: true } });
  });

  it("leaves the Cards that already exist as they are", async () => {
    const { core } = setup();
    await core.createCard(CARD);

    await core.changeSettings({ newCardsInQuizMode: true });

    expect((await core.listCards())[0]?.quizMode).toBe(false);
  });

  it("starts new Cards in Recall mode again once turned off", async () => {
    const { core } = setup();
    await core.changeSettings({ newCardsInQuizMode: true });

    await core.changeSettings({ newCardsInQuizMode: false });
    const result = await core.createCard(CARD);

    expect(result).toMatchObject({ ok: true, card: { quizMode: false } });
  });
});

describe("choosing Quiz mode with the Card's content", () => {
  const CARD = { cue: "A Cue", essence: "An Essence." };

  it("creates a Card in the mode given, whatever the setting", async () => {
    const { core } = setup();
    await core.changeSettings({ newCardsInQuizMode: true });

    const result = await core.createCard({ ...CARD, quizMode: false });

    expect(result).toMatchObject({ ok: true, card: { quizMode: false } });
  });

  it("switches the mode with an edit", async () => {
    const { core } = setup();
    const created = await core.createCard(CARD);
    if (!created.ok) throw new Error("the Card should be valid");

    const edited = await core.editCard(created.card.id, {
      ...CARD,
      quizMode: true,
    });

    expect(edited).toMatchObject({ ok: true, card: { quizMode: true } });
  });

  it("keeps the mode when an edit leaves it out", async () => {
    const { core } = setup();
    const created = await core.createCard({ ...CARD, quizMode: true });
    if (!created.ok) throw new Error("the Card should be valid");

    const edited = await core.editCard(created.card.id, CARD);

    expect(edited).toMatchObject({ ok: true, card: { quizMode: true } });
  });
});
