// The KIM connector: the MCP tools an AI assistant uses to act on the user's
// KIM. Tool descriptions are product surface, written with the same care as
// the app's copy: they are all the assistant knows of KIM's rules.
import {
  CAPTURES_PER_MONTH_MAX,
  CUE_MAX_CHARACTERS,
  ESSENCE_MAX_CHARACTERS,
  ESSENCE_MAX_LINES,
  HINTS_MAX_CHARACTERS,
  QUIZ_QUESTIONS_MAX,
  SOURCE_ASSISTANT_MAX_CHARACTERS,
  SOURCE_CONVERSATION_MAX_CHARACTERS,
  essenceRoom,
  type Card,
  type CaptureDraft,
  type CaptureProblem,
  type KimCore,
} from "@kim/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const CAPTURE_CARD_DESCRIPTION = `Save one Card to the user's KIM, the app that reminds them of what they learned just before they would forget it.

Use it only when the user asks to send, save or keep something in KIM. Then:
1. Call search_cards first to check whether the user already has a similar Card, and follow its guidance on duplicates.
2. Condense the conversation into its single key idea: one Card per Capture, never several. If the user wants to keep more than one idea, ask them which one comes first.
3. Respect the limits: a Cue of at most ${CUE_MAX_CHARACTERS} characters, phrased as a short question or title; an Essence of at most ${ESSENCE_MAX_CHARACTERS} characters and ${ESSENCE_MAX_LINES} lines, the key knowledge re-readable in seconds; optional Hints of at most ${HINTS_MAX_CHARACTERS} characters; up to ${QUIZ_QUESTIONS_MAX} Quiz questions, each with its expected answer.
4. Write the Card in the language of the conversation.
5. Show the draft to the user (Cue, Essence, Hints, Tags and Quiz questions) and call this tool only once they explicitly confirm it. If they ask for changes, show the new draft and wait for their confirmation again.`;

const captureCardInput = {
  cue: z
    .string()
    .describe(
      `The subject as a short question or title that triggers recall, at most ${CUE_MAX_CHARACTERS} characters.`,
    ),
  essence: z
    .string()
    .describe(
      `The key knowledge, at most ${ESSENCE_MAX_CHARACTERS} characters and ${ESSENCE_MAX_LINES} lines, such as up to ${ESSENCE_MAX_LINES} short bullets. KIM never rewrites it.`,
    ),
  hints: z
    .string()
    .optional()
    .describe(
      `An optional mnemonic, analogy or example, at most ${HINTS_MAX_CHARACTERS} characters.`,
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      "A few short Tags grouping the Card with related ones, such as the field it belongs to.",
    ),
  quizQuestions: z
    .array(
      z.object({
        question: z.string().describe("A question about the Card's knowledge."),
        answer: z.string().describe("The answer the user should give."),
      }),
    )
    .optional()
    .describe(
      `Up to ${QUIZ_QUESTIONS_MAX} questions that check the knowledge from different angles, asked in turn when the user reviews in Quiz mode.`,
    ),
  source: z
    .object({
      assistant: z
        .string()
        .describe(
          'Your name as the user knows you, such as "Claude" or "ChatGPT".',
        ),
      conversation: z
        .string()
        .describe("The conversation's title, or its link if you know it."),
    })
    .describe("Where the Card comes from, shown with it in the app."),
};

const SEARCH_CARDS_DESCRIPTION = `Search the user's KIM Cards by text and by Tag. Each Card comes back with its Cue, Essence, Hints, Tags and whether it is Archived (still kept and searchable, but no longer gets Nudges).

Use it:
- before you propose a Capture with capture_card: look for a Card on the same subject. If the user already has one, tell them ("you already have a Card on ...") so they avoid a duplicate, and let them decide whether to capture anyway.
- when the user asks what they saved in KIM about something ("what did I save about X?"): show them the matching Cards.

A Card matches the text when its Cue, Essence or Hints contain every word of it, ignoring case and accents; search with one or two key words of the subject rather than a full sentence, and try a synonym or the other language of the conversation if nothing comes back.`;

/** At most this many Cards come back, so a broad search stays readable. */
export const SEARCH_RESULTS_MAX = 20;

const searchCardsInput = {
  text: z
    .string()
    .optional()
    .describe(
      "Key words the Card must contain in its Cue, Essence or Hints. Leave it out to match any text.",
    ),
  tag: z
    .string()
    .optional()
    .describe("A Tag the Card must have. Leave it out to match any Tag."),
};

function describeCard(card: Card): string {
  return [
    `Cue: ${card.cue}`,
    `Essence: ${card.essence}`,
    `Hints: ${card.hints || "none"}`,
    `Tags: ${card.tags.length ? card.tags.join(", ") : "none"}`,
    `Archived: ${card.archived ? "yes" : "no"}`,
  ].join("\n");
}

function searchReport(found: Card[]): string {
  if (found.length === 0) return "The user has no Card matching this search.";
  const shown = found.slice(0, SEARCH_RESULTS_MAX);
  // core.searchCards returns the newest Cards first.
  const header =
    found.length > shown.length
      ? `${found.length} Cards match; here are the ${shown.length} newest. Narrow the search to see others.`
      : found.length === 1
        ? "1 Card matches."
        : `${found.length} Cards match.`;
  return [header, ...shown.map(describeCard)].join("\n\n");
}

function characters(text: string | undefined): number {
  return [...(text ?? "")].length;
}

/** What went wrong with the draft, said so the assistant can fix it. */
function explain(problem: CaptureProblem, draft: CaptureDraft): string {
  switch (problem) {
    case "cue-missing":
      return "The Cue is empty. Write the subject as a short question or title.";
    case "cue-too-long":
      return `The Cue has ${characters(draft.cue)} characters; the limit is ${CUE_MAX_CHARACTERS}. Shorten it.`;
    case "essence-missing":
      return "The Essence is empty. Write the key knowledge.";
    case "essence-too-long":
      return `The Essence has ${characters(draft.essence)} characters; the limit is ${ESSENCE_MAX_CHARACTERS}. Condense it to the key idea rather than splitting it into several Cards.`;
    case "essence-too-many-lines":
      return `The Essence has ${ESSENCE_MAX_LINES - essenceRoom(draft.essence).lines} lines; the limit is ${ESSENCE_MAX_LINES}. Merge or drop lines.`;
    case "hints-too-long":
      return `The Hints have ${characters(draft.hints)} characters; the limit is ${HINTS_MAX_CHARACTERS}. Shorten them.`;
    case "too-many-quiz-questions":
      return `There are ${draft.quizQuestions?.length} Quiz questions; the limit is ${QUIZ_QUESTIONS_MAX}. Keep the best ones.`;
    case "quiz-question-missing":
      return "A Quiz question is empty. Write it or remove it.";
    case "quiz-answer-missing":
      return "A Quiz question has no answer. Add its expected answer or remove it.";
    case "source-assistant-missing":
      return "The Source names no assistant. Give your name as the user knows you.";
    case "source-assistant-too-long":
      return `The Source's assistant name is longer than ${SOURCE_ASSISTANT_MAX_CHARACTERS} characters. Give just your name.`;
    case "source-conversation-missing":
      return "The Source names no conversation. Give the conversation's title, or its link.";
    case "source-conversation-too-long":
      return `The Source's conversation is longer than ${SOURCE_CONVERSATION_MAX_CHARACTERS} characters. Give a short title or the link.`;
    case "account-not-linked":
      return "This KIM account is not linked. Ask the user to sign in with Google or email in the KIM app, then connect KIM again.";
    case "capture-limit-reached":
      return `The user has already captured ${CAPTURES_PER_MONTH_MAX} Cards this month, the free plan's limit. Tell them; they can still write the Card in the KIM app.`;
  }
}

function refusal(problems: CaptureProblem[], draft: CaptureDraft): string {
  const fixable = problems.some(
    (problem) =>
      problem !== "account-not-linked" && problem !== "capture-limit-reached",
  );
  return [
    ...problems.map((problem) => explain(problem, draft)),
    fixable
      ? "Nothing was saved. Fix the draft, show it to the user again, and call capture_card once they confirm."
      : "Nothing was saved.",
  ].join("\n");
}

/** An MCP server acting on one user's KIM through the core. */
export function createKimMcpServer(core: KimCore): McpServer {
  const server = new McpServer({ name: "kim", version: "1.0.0" });

  server.registerTool(
    "capture_card",
    {
      title: "Save a Card to KIM",
      description: CAPTURE_CARD_DESCRIPTION,
      inputSchema: captureCardInput,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (draft) => {
      const result = await core.captureCard(draft);
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: refusal(result.problems, draft) }],
        };
      }
      const { card } = result;
      return {
        content: [
          {
            type: "text",
            text: `Saved to KIM: "${card.cue}". KIM will bring it back for a first Review on ${card.dueAt.toISOString()}.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "search_cards",
    {
      title: "Search the user's KIM Cards",
      description: SEARCH_CARDS_DESCRIPTION,
      inputSchema: searchCardsInput,
      annotations: { readOnlyHint: true },
    },
    async (search) => {
      const found = await core.searchCards(search);
      return { content: [{ type: "text", text: searchReport(found) }] };
    },
  );

  return server;
}
