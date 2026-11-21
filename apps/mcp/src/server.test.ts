import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  DEFAULT_SETTINGS,
  createCore,
  planNudges,
  type Card,
} from "@kim/core";
import { inMemoryBackend } from "@kim/core/src/testing/inMemoryBackend";
import { describe, expect, it } from "vitest";
import { SEARCH_RESULTS_MAX, createKimMcpServer } from "./server";

async function setup({
  linked = true,
  backend = inMemoryBackend(),
  person = "alice",
} = {}) {
  const { cards, accounts, settings, pushTokens } = backend.device(person);
  let now = new Date("2026-01-15T09:00:00.000Z");
  const core = createCore({
    clock: { now: () => now },
    cards,
    accounts,
    settings,
    pushTokens,
  });
  if (linked) await core.connect({ provider: "google" });

  const server = createKimMcpServer(core);
  const client = new Client({ name: "assistant", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const advanceMinutes = (minutes: number) => {
    now = new Date(now.getTime() + minutes * 60_000);
  };
  const setNow = (next: Date) => {
    now = next;
  };
  return { core, client, advanceMinutes, setNow, now: () => now };
}

const CAPTURE = {
  cue: "How does nuclear fusion work?",
  essence: "Light nuclei merge into a heavier one and release energy.",
  hints: "Think of the Sun.",
  tags: ["Physics"],
  quizQuestions: [
    { question: "What merges in fusion?", answer: "Light nuclei" },
  ],
  source: { assistant: "Claude", conversation: "Fusion basics" },
};

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as { type: string; text?: string }[];
  return content.map((part) => part.text ?? "").join("\n");
}

describe("capture_card", () => {
  it("tells the assistant the one-Card, limits, language and confirm-first rules", async () => {
    const { client } = await setup();

    const { tools } = await client.listTools();
    const tool = tools.find(({ name }) => name === "capture_card");

    expect(tool?.description).toMatch(/single key idea/i);
    expect(tool?.description).toMatch(/100 characters/);
    expect(tool?.description).toMatch(/280 characters/);
    expect(tool?.description).toMatch(/3 Quiz questions/);
    expect(tool?.description).toMatch(/language of the conversation/i);
    expect(tool?.description).toMatch(/explicitly confirm/i);
  });

  it("saves a confirmed Capture among the user's Cards, due like any new Card", async () => {
    const { core, client } = await setup();

    const result = await client.callTool({
      name: "capture_card",
      arguments: CAPTURE,
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("How does nuclear fusion work?");
    expect(await core.listCards()).toMatchObject([
      {
        cue: CAPTURE.cue,
        essence: CAPTURE.essence,
        hints: CAPTURE.hints,
        tags: ["Physics"],
        quizQuestions: CAPTURE.quizQuestions,
        source: CAPTURE.source,
      },
    ]);
    expect(await core.capturedThisMonth()).toBe(1);
  });

  it("saves a Capture with only a Cue, an Essence and a Source", async () => {
    const { core, client } = await setup();

    const result = await client.callTool({
      name: "capture_card",
      arguments: {
        cue: CAPTURE.cue,
        essence: CAPTURE.essence,
        source: CAPTURE.source,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(await core.listCards()).toMatchObject([
      { hints: "", tags: [], quizQuestions: [] },
    ]);
  });

  it("refuses an oversized Essence with a message the assistant can act on, and saves nothing", async () => {
    const { core, client } = await setup();

    const result = await client.callTool({
      name: "capture_card",
      arguments: { ...CAPTURE, essence: "e".repeat(300) },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Essence has 300 characters.*280/);
    expect(text(result)).toMatch(/Nothing was saved/);
    expect(await core.listCards()).toEqual([]);
  });

  it("refuses a long Cue and too many Quiz questions in one message", async () => {
    const { core, client } = await setup();

    const result = await client.callTool({
      name: "capture_card",
      arguments: {
        ...CAPTURE,
        cue: "c".repeat(120),
        quizQuestions: Array.from({ length: 4 }, (_, index) => ({
          question: `Question ${index}?`,
          answer: "An answer",
        })),
      },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Cue has 120 characters.*100/);
    expect(text(result)).toMatch(/4 Quiz questions.*3/);
    expect(await core.listCards()).toEqual([]);
  });

  it("refuses a Capture into an anonymous Account", async () => {
    const { core, client } = await setup({ linked: false });

    const result = await client.callTool({
      name: "capture_card",
      arguments: CAPTURE,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/sign in/i);
    expect(await core.listCards()).toEqual([]);
  });
});

describe("search_cards", () => {
  it("tells the assistant to check for a similar Card before proposing a Capture", async () => {
    const { client } = await setup();

    const { tools } = await client.listTools();
    const search = tools.find(({ name }) => name === "search_cards");
    const capture = tools.find(({ name }) => name === "capture_card");

    expect(search?.description).toMatch(/before (you )?propos\w* a Capture/i);
    expect(search?.description).toMatch(/already/i);
    expect(search?.annotations?.readOnlyHint).toBe(true);
    expect(capture?.description).toContain("search_cards");
  });

  it("finds a captured Card by text, with its Cue, Essence, Hints, Tags and Archived state", async () => {
    const { client } = await setup();
    await client.callTool({ name: "capture_card", arguments: CAPTURE });

    const result = await client.callTool({
      name: "search_cards",
      arguments: { text: "fusion" },
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain(CAPTURE.cue);
    expect(text(result)).toContain(CAPTURE.essence);
    expect(text(result)).toContain(CAPTURE.hints);
    expect(text(result)).toContain("Physics");
    expect(text(result)).toMatch(/Archived: no/);
  });

  it("finds a captured Card by Tag, whatever its case", async () => {
    const { client } = await setup();
    await client.callTool({ name: "capture_card", arguments: CAPTURE });
    await client.callTool({
      name: "capture_card",
      arguments: {
        ...CAPTURE,
        cue: "What is a black hole?",
        essence: "A region whose gravity lets nothing escape.",
        tags: ["Astronomy"],
      },
    });

    const result = await client.callTool({
      name: "search_cards",
      arguments: { tag: "physics" },
    });

    expect(text(result)).toContain(CAPTURE.cue);
    expect(text(result)).not.toContain("black hole");
  });

  it("shows an Archived Card as Archived", async () => {
    const { core, client } = await setup();
    await client.callTool({ name: "capture_card", arguments: CAPTURE });
    const [card] = await core.listCards();
    await core.archiveCard(card!.id);

    const result = await client.callTool({
      name: "search_cards",
      arguments: { text: "fusion" },
    });

    expect(text(result)).toContain(CAPTURE.cue);
    expect(text(result)).toMatch(/Archived: yes/);
  });

  it("returns the newest Cards of a broad search and says how many more match", async () => {
    const { client, advanceMinutes } = await setup();
    const captured = SEARCH_RESULTS_MAX + 2;
    for (let index = 1; index <= captured; index++) {
      advanceMinutes(1);
      await client.callTool({
        name: "capture_card",
        arguments: { ...CAPTURE, cue: `Fusion fact ${index}` },
      });
    }

    const result = await client.callTool({
      name: "search_cards",
      arguments: { text: "fusion" },
    });

    expect(text(result)).toContain(
      `${captured} Cards match; here are the ${SEARCH_RESULTS_MAX} newest`,
    );
    expect(text(result).match(/^Cue: /gm)).toHaveLength(SEARCH_RESULTS_MAX);
    expect(text(result)).toContain(`Cue: Fusion fact ${captured}\n`);
    expect(text(result)).not.toContain("Cue: Fusion fact 1\n");
  });

  it("says so when no Card matches", async () => {
    const { client } = await setup();
    await client.callTool({ name: "capture_card", arguments: CAPTURE });

    const result = await client.callTool({
      name: "search_cards",
      arguments: { text: "photosynthesis" },
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/no Card/i);
    expect(text(result)).not.toContain(CAPTURE.cue);
  });

  it("never returns another user's Cards", async () => {
    const backend = inMemoryBackend();
    const bob = await setup({ backend, person: "bob" });
    await bob.client.callTool({ name: "capture_card", arguments: CAPTURE });
    const alice = await setup({ backend, person: "alice" });

    const byText = await alice.client.callTool({
      name: "search_cards",
      arguments: { text: "fusion" },
    });
    const byTag = await alice.client.callTool({
      name: "search_cards",
      arguments: { tag: "Physics" },
    });
    const everything = await alice.client.callTool({
      name: "search_cards",
      arguments: {},
    });

    for (const result of [byText, byTag, everything]) {
      expect(text(result)).not.toContain(CAPTURE.cue);
    }
  });
});

type Context = Awaited<ReturnType<typeof setup>>;

/** Captures a Card and moves the clock to its first due date. */
async function dueCard(
  context: Context,
  capture: Record<string, unknown> = CAPTURE,
): Promise<Card> {
  await context.client.callTool({ name: "capture_card", arguments: capture });
  const [card] = await context.core.listCards();
  context.setNow(card!.dueAt);
  return card!;
}

describe("list_due_cards", () => {
  it("tells the assistant to bring up due Cards only when the user asks", async () => {
    const { client } = await setup();

    const { tools } = await client.listTools();
    const tool = tools.find(({ name }) => name === "list_due_cards");

    expect(tool?.description).toMatch(/only when the user asks/i);
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });

  it("returns a due Card with its id, Cue, Essence, Hints and Quiz questions", async () => {
    const context = await setup();
    const card = await dueCard(context);

    const result = await context.client.callTool({
      name: "list_due_cards",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain(card.id);
    expect(text(result)).toContain(CAPTURE.cue);
    expect(text(result)).toContain(CAPTURE.essence);
    expect(text(result)).toContain(CAPTURE.hints);
    expect(text(result)).toContain("What merges in fusion?");
    expect(text(result)).toContain("Light nuclei");
    expect(text(result)).toMatch(/Recall mode/);
  });

  it("says which Quiz question to ask for a Card in Quiz mode", async () => {
    const context = await setup();
    const card = await dueCard(context);
    await context.core.setQuizMode(card.id, true);

    const result = await context.client.callTool({
      name: "list_due_cards",
      arguments: {},
    });

    expect(text(result)).toMatch(/Quiz mode.*What merges in fusion\?/s);
  });

  it("leaves out Cards not yet due and Archived Cards", async () => {
    const context = await setup();
    const archived = await dueCard(context);
    await context.core.archiveCard(archived.id);
    context.advanceMinutes(1);
    const reviewed = await dueCard(context, {
      ...CAPTURE,
      cue: "What is a black hole?",
    });
    await context.core.recordReview({
      card: reviewed,
      channel: "app",
      mode: "recall",
      outcome: "remembered",
    });

    const result = await context.client.callTool({
      name: "list_due_cards",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/no Card due/i);
    expect(text(result)).not.toContain(CAPTURE.cue);
    expect(text(result)).not.toContain("black hole");
  });

  it("never returns another user's due Cards", async () => {
    const backend = inMemoryBackend();
    const bob = await setup({ backend, person: "bob" });
    const card = await dueCard(bob);
    const alice = await setup({ backend, person: "alice" });
    alice.setNow(card.dueAt);

    const result = await alice.client.callTool({
      name: "list_due_cards",
      arguments: {},
    });

    expect(text(result)).not.toContain(CAPTURE.cue);
  });
});

describe("record_review", () => {
  it("tells the assistant to record only a grade the user stated or confirmed", async () => {
    const { client } = await setup();

    const { tools } = await client.listTools();
    const tool = tools.find(({ name }) => name === "record_review");

    expect(tool?.description).toMatch(/stated or confirmed/i);
    expect(tool?.description).toMatch(/Essence/);
    expect(tool?.description).toContain("list_due_cards");
  });

  it("moves a due Card's next due date, and the Card leaves the due list", async () => {
    const context = await setup();
    const card = await dueCard(context);

    const result = await context.client.callTool({
      name: "record_review",
      arguments: { cardId: card.id, outcome: "remembered" },
    });

    expect(result.isError).toBeFalsy();
    const [reviewed] = await context.core.listCards();
    expect(reviewed!.dueAt.getTime()).toBeGreaterThan(card.dueAt.getTime());
    expect(text(result)).toContain(reviewed!.dueAt.toISOString());
    const due = await context.client.callTool({
      name: "list_due_cards",
      arguments: {},
    });
    expect(text(due)).not.toContain(CAPTURE.cue);
  });

  it("records a Recall outcome as a chat Review", async () => {
    const context = await setup();
    const card = await dueCard(context);

    await context.client.callTool({
      name: "record_review",
      arguments: { cardId: card.id, outcome: "forgotten" },
    });

    expect(await context.core.listReviews(card.id)).toMatchObject([
      { channel: "chat", mode: "recall", grade: "again" },
    ]);
  });

  it.each([
    ["forgot", "again"],
    ["hard", "hard"],
    ["good", "good"],
  ] as const)(
    "records the Quiz grade %s as a chat Quiz mode Review",
    async (outcome, grade) => {
      const context = await setup();
      const card = await dueCard(context);
      await context.core.setQuizMode(card.id, true);

      await context.client.callTool({
        name: "record_review",
        arguments: { cardId: card.id, outcome },
      });

      expect(await context.core.listReviews(card.id)).toMatchObject([
        { channel: "chat", mode: "quiz", grade },
      ]);
      const [reviewed] = await context.core.listCards();
      expect(reviewed!.quizTurn).toBe(1);
    },
  );

  it("refuses a Recall outcome for a Card reviewed in Quiz mode", async () => {
    const context = await setup();
    const card = await dueCard(context);
    await context.core.setQuizMode(card.id, true);

    const result = await context.client.callTool({
      name: "record_review",
      arguments: { cardId: card.id, outcome: "remembered" },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Quiz mode.*forgot.*hard.*good/);
    expect(await context.core.listReviews(card.id)).toEqual([]);
  });

  it("refuses a Card that is no longer due, so a Review is recorded once", async () => {
    const context = await setup();
    const card = await dueCard(context);
    await context.client.callTool({
      name: "record_review",
      arguments: { cardId: card.id, outcome: "remembered" },
    });

    const again = await context.client.callTool({
      name: "record_review",
      arguments: { cardId: card.id, outcome: "remembered" },
    });

    expect(again.isError).toBe(true);
    expect(text(again)).toMatch(/not due until/i);
    expect(await context.core.listReviews(card.id)).toHaveLength(1);
  });

  it("refuses another user's Card", async () => {
    const backend = inMemoryBackend();
    const bob = await setup({ backend, person: "bob" });
    const card = await dueCard(bob);
    const alice = await setup({ backend, person: "alice" });
    alice.setNow(card.dueAt);

    const result = await alice.client.callTool({
      name: "record_review",
      arguments: { cardId: card.id, outcome: "remembered" },
    });

    expect(result.isError).toBe(true);
    expect(await bob.core.listReviews(card.id)).toEqual([]);
  });

  it("takes the Card out of the next Nudge plan", async () => {
    const context = await setup();
    const card = await dueCard(context);
    const plan = async () =>
      planNudges({
        linked: true,
        settings: {
          ...DEFAULT_SETTINGS,
          nudgesOn: true,
          timeZone: "UTC",
          nudgeWindows: [{ start: 0, end: 24 * 60 }],
        },
        cards: await context.core.listCards(),
        sent: [],
        now: context.now(),
      });
    expect(await plan()).not.toEqual([]);

    await context.client.callTool({
      name: "record_review",
      arguments: { cardId: card.id, outcome: "remembered" },
    });

    expect(await plan()).toEqual([]);
  });
});

/** Remembers the Card in chat on each due date until KIM proposes archiving it. */
async function reviewUntilArchiveProposal(
  context: Context,
  card: Card,
): Promise<string> {
  for (let review = 0; review < 50; review++) {
    const [current] = await context.core.listCards();
    context.setNow(current!.dueAt);
    const result = await context.client.callTool({
      name: "record_review",
      arguments: { cardId: card.id, outcome: "remembered" },
    });
    if (/archiv/i.test(text(result))) return text(result);
  }
  throw new Error("KIM never proposed archiving the Card");
}

describe("the archive proposal in chat", () => {
  it("is returned by record_review, naming the tool that answers it", async () => {
    const context = await setup();
    const card = await dueCard(context);

    const proposal = await reviewUntilArchiveProposal(context, card);

    expect(proposal).toContain("answer_archive_proposal");
  });

  it("archives the Card when the user accepts it", async () => {
    const context = await setup();
    const card = await dueCard(context);
    await reviewUntilArchiveProposal(context, card);

    const result = await context.client.callTool({
      name: "answer_archive_proposal",
      arguments: { cardId: card.id, archive: true },
    });

    expect(result.isError).toBeFalsy();
    expect(await context.core.listCards()).toMatchObject([{ archived: true }]);
  });

  it("keeps the Card scheduled and never proposes again when the user declines", async () => {
    const context = await setup();
    const card = await dueCard(context);
    await reviewUntilArchiveProposal(context, card);

    await context.client.callTool({
      name: "answer_archive_proposal",
      arguments: { cardId: card.id, archive: false },
    });

    expect(await context.core.listCards()).toMatchObject([
      { archived: false, archiveProposalDeclined: true },
    ]);
  });

  it.each([true, false])(
    "refuses an answer (archive: %s) when KIM made no proposal for the Card",
    async (archive) => {
      const context = await setup();
      const card = await dueCard(context);

      const result = await context.client.callTool({
        name: "answer_archive_proposal",
        arguments: { cardId: card.id, archive },
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/no proposal/i);
      expect(await context.core.listCards()).toMatchObject([
        { archived: false, archiveProposalDeclined: false },
      ]);
    },
  );

  it("refuses another user's Card", async () => {
    const backend = inMemoryBackend();
    const bob = await setup({ backend, person: "bob" });
    const card = await dueCard(bob);
    const alice = await setup({ backend, person: "alice" });

    const result = await alice.client.callTool({
      name: "answer_archive_proposal",
      arguments: { cardId: card.id, archive: true },
    });

    expect(result.isError).toBe(true);
    expect(await bob.core.listCards()).toMatchObject([{ archived: false }]);
  });
});
