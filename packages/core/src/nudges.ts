// Nudge planning, shared by the app's core and the Nudge job. The job runs
// on Deno and holds a copy of this file in supabase/functions/_shared, kept
// identical by a test, so this file imports nothing.

/** The languages a Nudge is written in, as the app speaks them. */
export const NUDGE_LANGUAGES = ["en", "fr"] as const;

export type NudgeLanguage = (typeof NUDGE_LANGUAGES)[number];

/** The Android channel Nudges arrive on, created by the app. */
export const NUDGE_CHANNEL_ID = "nudges";

/**
 * A Nudge window: a range of local time, in minutes after midnight, during
 * which Nudges may be sent. One that ends before it starts runs across
 * midnight.
 */
export type NudgeWindow = { start: number; end: number };

/** The user's choices about Nudges. */
export type NudgeSettings = {
  nudgesOn: boolean;
  nudgeWindows: NudgeWindow[];
  /** How many single-Card Nudges may be sent per local day. */
  dailyNudgeCap: number;
  /** An IANA time zone; null until the app saves the phone's. */
  timeZone: string | null;
};

/** The most single-Card Nudges a user may choose to get a day. */
export const DAILY_NUDGE_CAP_MAX = 10;

export const DEFAULT_NUDGE_SETTINGS: NudgeSettings = {
  nudgesOn: true,
  nudgeWindows: [{ start: 9 * 60, end: 21 * 60 }],
  dailyNudgeCap: 3,
  timeZone: null,
};

/** What planning needs to know of a Card. */
export type NudgeCandidate = {
  id: string;
  cue: string;
  dueAt: Date;
  archived: boolean;
};

/** A Card as a Nudge is about it: for its due date at the time. */
export type NudgedCard = { cardId: string; dueAt: Date };

/**
 * A Card nudged for a due date, alone or within a grouped Nudge: a Card is
 * nudged once per due date.
 */
export type SentNudge = NudgedCard & { sentAt: Date; grouped: boolean };

/**
 * A Nudge to send now: about one Card for its current due date, or grouping
 * the due Cards past the daily cap, which opens the run of due Cards.
 */
export type PlannedNudge =
  | { kind: "card"; cardId: string; cue: string; dueAt: Date }
  | { kind: "group"; cards: NudgedCard[] };

/**
 * The Nudges to send an Account now. Inside a Nudge window, each due Card
 * not yet nudged for its current due date gets a Nudge of its own, longest
 * due first, up to the daily cap; the rest are grouped into one Nudge, once
 * a local day. Due Cards left out wait for the next window. A Card reviewed
 * since it came due has a new due date in the future, so it drops out with
 * no cancellation. Anonymous Accounts, and users who turned Nudges off, get
 * none.
 */
export function planNudges({
  linked,
  settings,
  cards,
  sent,
  now,
}: {
  linked: boolean;
  settings: NudgeSettings;
  cards: NudgeCandidate[];
  sent: SentNudge[];
  now: Date;
}): PlannedNudge[] {
  if (!linked || !settings.nudgesOn) return [];
  const local = localTime(now, settings.timeZone);
  if (!settings.nudgeWindows.some((window) => inWindow(local.minute, window))) {
    return [];
  }
  const nudged = new Set(sent.map(nudgeKey));
  const due = cards
    .filter((card) => !card.archived && card.dueAt <= now)
    .filter((card) => !nudged.has(nudgeKey({ cardId: card.id, dueAt: card.dueAt })))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  const sentToday = sent.filter(
    ({ sentAt }) => localTime(sentAt, settings.timeZone).day === local.day,
  );
  const singlesLeft = Math.max(
    0,
    settings.dailyNudgeCap - sentToday.filter(({ grouped }) => !grouped).length,
  );
  const singles: PlannedNudge[] = due
    .slice(0, singlesLeft)
    .map(({ id, cue, dueAt }) => ({ kind: "card", cardId: id, cue, dueAt }));
  const overflow = due.slice(singlesLeft);
  if (overflow.length === 0 || sentToday.some(({ grouped }) => grouped)) {
    return singles;
  }
  return [
    ...singles,
    {
      kind: "group",
      cards: overflow.map(({ id, dueAt }) => ({ cardId: id, dueAt })),
    },
  ];
}

function inWindow(minute: number, { start, end }: NudgeWindow): boolean {
  return start <= end
    ? start <= minute && minute < end
    : minute >= start || minute < end;
}

/** Whether the time zone is one KIM can plan Nudges in. */
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The local day and minute of the instant, in the time zone. An unknown or
 * missing time zone counts as UTC, so one bad setting never stops the job.
 */
function localTime(
  at: Date,
  timeZone: string | null,
): { day: string; minute: number } {
  const zone = timeZone !== null && isTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "0";
  return {
    day: `${part("year")}-${part("month")}-${part("day")}`,
    minute: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

function nudgeKey({ cardId, dueAt }: NudgedCard): string {
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

const NUDGE_GROUP_BODIES: Record<NudgeLanguage, (count: number) => string> = {
  en: (count) => `${count} more ${count === 1 ? "thing" : "things"} to reinforce`,
  fr: (count) =>
    count === 1 ? "1 autre chose à renforcer" : `${count} autres choses à renforcer`,
};

/** The grouped Nudge: how many more due Cards wait past the daily cap. */
export function nudgeGroupMessage(
  count: number,
  language: NudgeLanguage,
): { title: string; body: string } {
  return { title: "KIM", body: NUDGE_GROUP_BODIES[language](count) };
}

/** The first of the device's languages, by preference, that KIM speaks. */
export function nudgeLanguage(languageCodes: readonly string[]): NudgeLanguage {
  for (const code of languageCodes) {
    const spoken = NUDGE_LANGUAGES.find((language) => language === code);
    if (spoken) return spoken;
  }
  return "en";
}
