import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCore } from "@kim/core";
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
  return { core, client, advanceMinutes };
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
