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
  type CaptureDraft,
  type CaptureProblem,
  type KimCore,
} from "@kim/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const CAPTURE_CARD_DESCRIPTION = `Save one Card to the user's KIM, the app that reminds them of what they learned just before they would forget it.

Use it only when the user asks to send, save or keep something in KIM. Then:
1. Condense the conversation into its single key idea: one Card per Capture, never several. If the user wants to keep more than one idea, ask them which one comes first.
2. Respect the limits: a Cue of at most ${CUE_MAX_CHARACTERS} characters, phrased as a short question or title; an Essence of at most ${ESSENCE_MAX_CHARACTERS} characters and ${ESSENCE_MAX_LINES} lines, the key knowledge re-readable in seconds; optional Hints of at most ${HINTS_MAX_CHARACTERS} characters; up to ${QUIZ_QUESTIONS_MAX} Quiz questions, each with its expected answer.
3. Write the Card in the language of the conversation.
4. Show the draft to the user (Cue, Essence, Hints, Tags and Quiz questions) and call this tool only once they explicitly confirm it. If they ask for changes, show the new draft and wait for their confirmation again.`;

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

  return server;
}
