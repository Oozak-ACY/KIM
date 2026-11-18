// Nudge planning, shared by the app's core and the Nudge job. The job runs
// on Deno and holds a copy of this file in supabase/functions/_shared, kept
// identical by a test, so this file imports nothing.

/** The languages a Nudge is written in, as the app speaks them. */
export const NUDGE_LANGUAGES = ["en", "fr"] as const;

export type NudgeLanguage = (typeof NUDGE_LANGUAGES)[number];

/** The Android channel Nudges arrive on, created by the app. */
export const NUDGE_CHANNEL_ID = "nudges";

/**
 * How long a Card counts as newly due. One that came due earlier, before the
 * phone was registered or while the job was down, waits in the app instead
 * of arriving in a burst of Nudges.
 */
export const NEWLY_DUE_MS = 24 * 60 * 60 * 1000;

/** What planning needs to know of a Card. */
export type NudgeCandidate = {
  id: string;
  cue: string;
  dueAt: Date;
  archived: boolean;
};

/** A Nudge already sent: a Card is nudged once per due date. */
export type SentNudge = { cardId: string; dueAt: Date };

/** A Nudge to send now, for the Card's current due date. */
export type PlannedNudge = { cardId: string; cue: string; dueAt: Date };

/**
 * The Nudges to send an Account now: one per newly due Card not yet nudged
 * for its current due date, longest due first. A Card reviewed since it came
 * due has a new due date in the future, so it drops out with no
 * cancellation. Anonymous Accounts get none.
 */
export function planNudges({
  linked,
  cards,
  sent,
  now,
}: {
  linked: boolean;
  cards: NudgeCandidate[];
  sent: SentNudge[];
  now: Date;
}): PlannedNudge[] {
  if (!linked) return [];
  const nudged = new Set(sent.map(nudgeKey));
  const newlyDueFrom = now.getTime() - NEWLY_DUE_MS;
  return cards
    .filter((card) => !card.archived && card.dueAt <= now)
    .filter((card) => card.dueAt.getTime() >= newlyDueFrom)
    .filter((card) => !nudged.has(nudgeKey({ cardId: card.id, dueAt: card.dueAt })))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .map(({ id, cue, dueAt }) => ({ cardId: id, cue, dueAt }));
}

function nudgeKey({ cardId, dueAt }: SentNudge): string {
  return `${cardId}@${dueAt.getTime()}`;
}

const NUDGE_BODIES: Record<NudgeLanguage, string> = {
  en: "Do you still remember it? Time to reinforce it.",
  fr: "Vous en souvenez-vous encore ? C'est le moment de le renforcer.",
};

/** The Nudge as the phone shows it: the Cue, then a question about it. */
export function nudgeMessage(
  cue: string,
  language: NudgeLanguage,
): { title: string; body: string } {
  return { title: cue, body: NUDGE_BODIES[language] };
}

/** The first of the device's languages, by preference, that KIM speaks. */
export function nudgeLanguage(languageCodes: readonly string[]): NudgeLanguage {
  for (const code of languageCodes) {
    const spoken = NUDGE_LANGUAGES.find((language) => language === code);
    if (spoken) return spoken;
  }
  return "en";
}
