import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createCore,
  nudgeLanguage,
  nudgeGroupMessage,
  nudgeMessage,
  planNudges,
  type PlannedNudge,
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
    settings: await core.settings(),
    cards: await core.listCards(),
    sent,
    now: clock(),
  });
}

const ALL_DAY = { start: 0, end: 24 * 60 };

/** The Nudges as the job logs them once sent. */
function sentAt(planned: PlannedNudge[], at: Date): SentNudge[] {
  return planned.flatMap((nudge): SentNudge[] =>
    nudge.kind === "card"
      ? [{ cardId: nudge.cardId, dueAt: nudge.dueAt, sentAt: at, grouped: false }]
      : nudge.cards.map(({ cardId, dueAt }) => ({ cardId, dueAt, sentAt: at, grouped: true })),
  );
}

function cardIdOf(nudge: PlannedNudge): string | undefined {
  return nudge.kind === "card" ? nudge.cardId : undefined;
}

/** A linked Account that may be nudged at any time, unless a test says otherwise. */
async function linkedSetup(now?: string) {
  const context = setup(now);
  await context.core.connect({ provider: "google" });
  await context.core.changeSettings({ nudgeWindows: [ALL_DAY] });
  return context;
}

describe("planning Nudges", () => {
  it("nudges each due Card of a linked Account once, with its Cue", async () => {
    const context = await linkedSetup();
    const card = await create(context.core, "How does nuclear fusion work?");

    expect(await plan(context)).toEqual([
      { kind: "card", cardId: card.id, cue: card.cue, dueAt: card.dueAt },
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
      { kind: "card", cardId: card.id, cue: card.cue, dueAt: reviewed.dueAt },
    ]);
  });

  it("never nudges a Card twice for the same due date", async () => {
    const context = await linkedSetup();
    const card = await create(context.core, "What is KIM?");
    const sent = sentAt(await plan(context), context.clock());

    context.setNow("2026-01-16T09:00:00.000Z");

    expect(await plan(context, sent)).toEqual([]);
  });

  it("nudges a Card again once it is due on a new date", async () => {
    const context = await linkedSetup();
    const card = await create(context.core, "What is KIM?");
    const sent = sentAt(await plan(context), context.clock());
    const reviewed = await context.core.recordReview({
      card,
      channel: "app",
      mode: "recall",
      outcome: "forgotten",
    });

    context.setNow(reviewed.dueAt.toISOString());

    expect(await plan(context, sent)).toEqual([
      { kind: "card", cardId: card.id, cue: card.cue, dueAt: reviewed.dueAt },
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
      { kind: "card", cardId: leftDue.id, cue: leftDue.cue, dueAt: leftDue.dueAt },
    ]);
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

    expect((await plan(context)).map(cardIdOf)).toEqual([
      first.id,
      second.id,
    ]);
  });
});

describe("Nudge windows", () => {
  it("sends no Nudge outside every Nudge window", async () => {
    const context = await linkedSetup();
    await context.core.changeSettings({
      nudgeWindows: [{ start: 10 * 60, end: 12 * 60 }],
    });
    await create(context.core, "What is KIM?");

    expect(await plan(context)).toEqual([]);
  });

  it("follows the user's time zone through a window across midnight", async () => {
    // 01:30 in Paris, inside a 22:00 to 02:00 window.
    const context = await linkedSetup("2026-01-15T00:30:00.000Z");
    await context.core.changeSettings({
      timeZone: "Europe/Paris",
      nudgeWindows: [{ start: 22 * 60, end: 2 * 60 }],
    });
    const card = await create(context.core, "What is KIM?");

    expect(await plan(context)).toEqual([
      { kind: "card", cardId: card.id, cue: card.cue, dueAt: card.dueAt },
    ]);

    // 02:30 in Paris: the window has closed.
    context.setNow("2026-01-15T01:30:00.000Z");
    expect(await plan(context)).toEqual([]);

    // 23:00 in Paris, though 22:00 in UTC: the window is open again.
    context.setNow("2026-01-15T22:00:00.000Z");
    expect(await plan(context)).toHaveLength(1);
  });

  it("keeps to local time when the clocks change", async () => {
    // 09:30 in Paris on the day summer time starts, though 08:30 in winter time.
    const context = await linkedSetup("2026-03-29T07:30:00.000Z");
    await context.core.changeSettings({
      timeZone: "Europe/Paris",
      nudgeWindows: [{ start: 9 * 60, end: 21 * 60 }],
    });
    await create(context.core, "What is KIM?");

    expect(await plan(context)).toHaveLength(1);
  });

  it("sends Nudges in any of several windows", async () => {
    const context = await linkedSetup("2026-01-15T18:30:00.000Z");
    await context.core.changeSettings({
      nudgeWindows: [
        { start: 8 * 60, end: 9 * 60 },
        { start: 18 * 60, end: 19 * 60 },
      ],
    });
    await create(context.core, "What is KIM?");

    expect(await plan(context)).toHaveLength(1);
  });

  it("sends no Nudge when Nudges are off", async () => {
    const context = await linkedSetup();
    await context.core.changeSettings({ nudgesOn: false });
    await create(context.core, "What is KIM?");

    expect(await plan(context)).toEqual([]);
  });
});

describe("the daily cap", () => {
  async function createSeveral(core: ReturnType<typeof setup>["core"], count: number) {
    const cards = [];
    for (let index = 1; index <= count; index++) {
      cards.push(await create(core, `Card ${index}`));
    }
    return cards;
  }

  it("sends at most the daily cap of single-Card Nudges, and groups the rest into one", async () => {
    const context = await linkedSetup();
    const [first, second, third, fourth, fifth] = await createSeveral(context.core, 5);

    expect(await plan(context)).toEqual([
      { kind: "card", cardId: first!.id, cue: first!.cue, dueAt: first!.dueAt },
      { kind: "card", cardId: second!.id, cue: second!.cue, dueAt: second!.dueAt },
      { kind: "card", cardId: third!.id, cue: third!.cue, dueAt: third!.dueAt },
      {
        kind: "group",
        cards: [
          { cardId: fourth!.id, dueAt: fourth!.dueAt },
          { cardId: fifth!.id, dueAt: fifth!.dueAt },
        ],
      },
    ]);
  });

  it("follows the cap the user chose", async () => {
    const context = await linkedSetup();
    await context.core.changeSettings({ dailyNudgeCap: 1 });
    await createSeveral(context.core, 3);

    expect((await plan(context)).map(({ kind }) => kind)).toEqual(["card", "group"]);
  });

  it("counts the Nudges already sent today against the cap", async () => {
    const context = await linkedSetup();
    await context.core.changeSettings({ dailyNudgeCap: 2 });
    await createSeveral(context.core, 1);
    const sent = sentAt(await plan(context), context.clock());

    context.setNow("2026-01-15T12:00:00.000Z");
    const [second, third] = await createSeveral(context.core, 2);

    expect(await plan(context, sent)).toEqual([
      { kind: "card", cardId: second!.id, cue: second!.cue, dueAt: second!.dueAt },
      {
        kind: "group",
        cards: [{ cardId: third!.id, dueAt: third!.dueAt }],
      },
    ]);
  });

  it("sends one grouped Nudge a day: later due Cards roll over to the next day", async () => {
    const context = await linkedSetup();
    await context.core.changeSettings({ dailyNudgeCap: 1 });
    await createSeveral(context.core, 2);
    const sent = sentAt(await plan(context), context.clock());

    context.setNow("2026-01-15T12:00:00.000Z");
    const [later] = await createSeveral(context.core, 1);
    expect(await plan(context, sent)).toEqual([]);

    context.setNow("2026-01-16T00:00:00.000Z");
    expect(await plan(context, sent)).toEqual([
      { kind: "card", cardId: later!.id, cue: later!.cue, dueAt: later!.dueAt },
    ]);
  });

  it("starts the count afresh at midnight in the user's time zone", async () => {
    // 23:30 in Paris, still 22:30 in UTC.
    const context = await linkedSetup("2026-01-15T22:30:00.000Z");
    await context.core.changeSettings({ dailyNudgeCap: 1, timeZone: "Europe/Paris" });
    await createSeveral(context.core, 1);
    const sent = sentAt(await plan(context), context.clock());

    // 00:30 in Paris, the next local day, though the same day in UTC.
    context.setNow("2026-01-15T23:30:00.000Z");
    const [next] = await createSeveral(context.core, 1);

    expect(await plan(context, sent)).toEqual([
      { kind: "card", cardId: next!.id, cue: next!.cue, dueAt: next!.dueAt },
    ]);
  });

  it("brings a backlog of long overdue Cards within the cap", async () => {
    const context = await linkedSetup();
    await createSeveral(context.core, 6);

    context.setNow("2026-03-01T09:00:00.000Z");
    const planned = await plan(context);

    expect(planned.map(({ kind }) => kind)).toEqual(["card", "card", "card", "group"]);
    expect(planned[3]).toMatchObject({ kind: "group", cards: { length: 3 } });
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

  it("counts the grouped Cards in English", () => {
    expect(nudgeGroupMessage(4, "en")).toEqual({
      title: "KIM",
      body: "4 more things to reinforce",
    });
    expect(nudgeGroupMessage(1, "en").body).toBe("1 more thing to reinforce");
  });

  it("counts the grouped Cards in French", () => {
    expect(nudgeGroupMessage(4, "fr").body).toBe("4 autres choses à renforcer");
    expect(nudgeGroupMessage(1, "fr").body).toBe("1 autre chose à renforcer");
  });

  it("speaks the first of the device's languages that KIM speaks", () => {
    expect(nudgeLanguage(["de", "fr", "en"])).toBe("fr");
    expect(nudgeLanguage(["de"])).toBe("en");
  });
});

describe("the Nudge settings", () => {
  it("nudge 3 times a day at most, from 9:00 to 21:00, by default", async () => {
    const { core } = setup();

    expect(await core.settings()).toMatchObject({
      nudgesOn: true,
      nudgeWindows: [{ start: 9 * 60, end: 21 * 60 }],
      dailyNudgeCap: 3,
      timeZone: null,
    });
  });

  it("are kept for the user, across their phones", async () => {
    const backend = inMemoryBackend();
    const clock = { now: () => new Date("2026-01-15T09:00:00.000Z") };
    const phone = createCore({ clock, ...backend.device("alice") });
    const tablet = createCore({ clock, ...backend.device("alice") });
    await phone.connect({ provider: "google" });
    const changes = {
      nudgesOn: false,
      nudgeWindows: [{ start: 7 * 60, end: 8 * 60 }, { start: 22 * 60, end: 60 }],
      dailyNudgeCap: 5,
      timeZone: "America/New_York",
    };
    await phone.changeSettings(changes);

    await tablet.connect({ provider: "google" });

    expect(await tablet.settings()).toMatchObject(changes);
  });
});

describe("registering for Nudges", () => {
  it("registers the phone of a linked Account with its language", async () => {
    const { core, backend } = await linkedSetup();

    expect(
      await core.registerForNudges("ExponentPushToken[abc]", "fr", "Europe/Paris"),
    ).toBe(true);
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

    expect(
      await core.registerForNudges("ExponentPushToken[abc]", "en", "Europe/Paris"),
    ).toBe(false);
    expect(backend.pushTokens()).toEqual([]);
  });
});

describe("the time zone of Nudges", () => {
  it("is the phone's once it registers for Nudges", async () => {
    const { core } = await linkedSetup();

    await core.registerForNudges("ExponentPushToken[abc]", "fr", "Europe/Paris");

    expect((await core.settings()).timeZone).toBe("Europe/Paris");
  });

  it("stays the one the user chose", async () => {
    const { core } = await linkedSetup();
    await core.changeSettings({ timeZone: "Asia/Tokyo" });

    await core.registerForNudges("ExponentPushToken[abc]", "fr", "Europe/Paris");

    expect((await core.settings()).timeZone).toBe("Asia/Tokyo");
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
