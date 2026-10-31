import {
  DefaultScheduler,
  Rating,
  type DefaultSchedulerCard,
  type DefaultSchedulerCardInput,
} from "ts-fsrs";

/** FSRS memory state in a JSON form that stores can keep as is. */
export type Schedule = Record<string, unknown>;

export type ScheduledCard = { dueAt: Date; schedule: Schedule };

export type Grade = "again" | "good";

const RATINGS = { again: Rating.Again, good: Rating.Good } as const;

const scheduler = DefaultScheduler();

function toScheduled({ dueAt, ...memory }: DefaultSchedulerCard): ScheduledCard {
  return { dueAt, schedule: JSON.parse(JSON.stringify(memory)) };
}

function toFsrsCard({ dueAt, schedule }: ScheduledCard) {
  const { lastReviewAt } = schedule;
  return {
    ...schedule,
    dueAt,
    lastReviewAt:
      typeof lastReviewAt === "string" ? new Date(lastReviewAt) : null,
  } as DefaultSchedulerCardInput;
}

export async function firstSchedule(now: Date): Promise<ScheduledCard> {
  return toScheduled((await scheduler).newCard({ now }));
}

export async function nextSchedule(
  card: ScheduledCard,
  grade: Grade,
  now: Date,
): Promise<ScheduledCard> {
  const { card: reviewed } = (await scheduler).review({
    card: toFsrsCard(card),
    grade: RATINGS[grade],
    now,
  });
  return toScheduled(reviewed);
}
