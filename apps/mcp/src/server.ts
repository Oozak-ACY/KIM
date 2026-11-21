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
  archiveProposalOpen,
  essenceRoom,
  reviewStyle,
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

const LIST_DUE_CARDS_DESCRIPTION = `List the user's KIM Cards that are due for a Review now, the longest due first, so you can run a Chat Review with them in this conversation.

Use it only when the user asks to review, for instance "anything to reinforce?" or "quiz me on my KIM Cards". Never bring up due Cards on your own.

Each Card comes with its id, Cue, Essence, Hints, Quiz questions and how to review it. Then, one Card at a time, follow record_review's steps.`;

const RECORD_REVIEW_DESCRIPTION = `Record the outcome of a Chat Review of one due Card from list_due_cards. It counts exactly like a Review in the KIM app: it schedules the Card's next Review.

Use it only when the user asks to review their Cards. For each Card:
1. In Recall mode, show the Cue and let the user try to remember. In Quiz mode, ask the Quiz question given by list_due_cards and let the user answer.
2. Reveal the Essence (and the expected answer in Quiz mode), with the Hints if they help.
3. Ask the user to grade themselves: in Recall mode, remembered or forgotten; in Quiz mode, Forgot, Hard or Good. You may suggest a grade, but the user decides.
4. Call this tool only once the user has stated or confirmed their grade, and only once per Card.

If the result proposes archiving the Card, ask the user whether to archive it, and give their answer to answer_archive_proposal.`;

const ANSWER_ARCHIVE_PROPOSAL_DESCRIPTION = `Give the user's answer to KIM's proposal to archive a Card, made by record_review once the user remembered the Card after a six month interval.

Use it only once the user has answered the proposal. Archived, the Card stays kept and searchable but no longer gets Nudges. Declined, the Card stays scheduled and KIM never proposes archiving it again.`;

const RECALL_OUTCOMES = ["remembered", "forgotten"] as const;
const QUIZ_OUTCOMES = ["forgot", "hard", "good"] as const;

function isRecallOutcome(
  outcome: string,
): outcome is (typeof RECALL_OUTCOMES)[number] {
  return (RECALL_OUTCOMES as readonly string[]).includes(outcome);
}

const recordReviewInput = {
  cardId: z.string().describe("The Card's id, as given by list_due_cards."),
  outcome: z
    .enum([...RECALL_OUTCOMES, ...QUIZ_OUTCOMES])
    .describe(
      'The grade the user stated or confirmed: "remembered" or "forgotten" in Recall mode; "forgot", "hard" or "good" in Quiz mode.',
    ),
};

const answerArchiveProposalInput = {
  cardId: z.string().describe("The Card's id."),
  archive: z
    .boolean()
    .describe(
      "True when the user wants the Card archived, false when they want to keep reviewing it.",
    ),
};

function describeDueCard(card: Card): string {
  const style = reviewStyle(card);
  const quizQuestions = card.quizQuestions.length
    ? card.quizQuestions
        .map(({ question, answer }) => `- ${question} (answer: ${answer})`)
        .join("\n")
    : "none";
  return [
    `Card id: ${card.id}`,
    style.mode === "quiz"
      ? `Review in Quiz mode: ask "${style.quizQuestion.question}" (expected answer: ${style.quizQuestion.answer})`
      : "Review in Recall mode: show the Cue",
    `Cue: ${card.cue}`,
    `Essence: ${card.essence}`,
    `Hints: ${card.hints || "none"}`,
    `Quiz questions:\n${quizQuestions}`,
    `Due since: ${card.dueAt.toISOString()}`,
  ].join("\n");
}

function dueReport(due: Card[]): string {
  if (due.length === 0) {
    return "The user has no Card due for a Review right now. Tell them they are up to date.";
  }
  const header =
    due.length === 1 ? "1 Card is due." : `${due.length} Cards are due.`;
  return [header, ...due.map(describeDueCard)].join("\n\n");
}

function errorResult(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

const UNKNOWN_CARD =
  "The user has no Card with this id. Use the id given by list_due_cards.";

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

  server.registerTool(
    "list_due_cards",
    {
      title: "List the user's due KIM Cards",
      description: LIST_DUE_CARDS_DESCRIPTION,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => textResult(dueReport(await core.dueCards())),
  );

  server.registerTool(
    "record_review",
    {
      title: "Record a Chat Review in KIM",
      description: RECORD_REVIEW_DESCRIPTION,
      inputSchema: recordReviewInput,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ cardId, outcome }) => {
      const card = (await core.dueCards()).find(({ id }) => id === cardId);
      if (!card) {
        const known = (await core.listCards()).find(({ id }) => id === cardId);
        if (!known) return errorResult(UNKNOWN_CARD);
        return errorResult(
          known.archived
            ? `"${known.cue}" is Archived, so it is not reviewed. Nothing was recorded.`
            : `"${known.cue}" is not due until ${known.dueAt.toISOString()}. Nothing was recorded.`,
        );
      }

      const { mode } = reviewStyle(card);
      const answer = isRecallOutcome(outcome)
        ? ({ mode: "recall", outcome } as const)
        : ({ mode: "quiz", outcome } as const);
      if (answer.mode !== mode) {
        return errorResult(
          mode === "quiz"
            ? `"${card.cue}" is reviewed in Quiz mode: grade it "forgot", "hard" or "good". Nothing was recorded.`
            : `"${card.cue}" is reviewed in Recall mode: grade it "remembered" or "forgotten". Nothing was recorded.`,
        );
      }

      const reviewed = await core.recordReview({
        card,
        channel: "chat",
        ...answer,
      });
      const recorded = `Recorded. KIM will bring "${card.cue}" back for its next Review on ${reviewed.dueAt.toISOString()}.`;
      return textResult(
        reviewed.archiveProposed
          ? `${recorded}\nThe user remembered this Card after a six month interval, so KIM proposes archiving it: it would stay kept and searchable, but no longer get Nudges. Ask the user whether to archive it, and give their answer to answer_archive_proposal.`
          : recorded,
      );
    },
  );

  server.registerTool(
    "answer_archive_proposal",
    {
      title: "Answer KIM's proposal to archive a Card",
      description: ANSWER_ARCHIVE_PROPOSAL_DESCRIPTION,
      inputSchema: answerArchiveProposalInput,
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ cardId, archive }) => {
      const card = (await core.listCards()).find(({ id }) => id === cardId);
      if (!card) return errorResult(UNKNOWN_CARD);
      if (!archiveProposalOpen(card)) {
        return errorResult(
          `KIM made no proposal to archive "${card.cue}", so there is nothing to answer. Nothing was changed.`,
        );
      }
      if (archive) {
        await core.archiveCard(cardId);
        return textResult(
          `"${card.cue}" is Archived. It stays kept and searchable, and no longer gets Nudges.`,
        );
      }
      await core.declineArchiveProposal(cardId);
      return textResult(
        `"${card.cue}" stays scheduled, and KIM will not propose archiving it again.`,
      );
    },
  );

  return server;
}
