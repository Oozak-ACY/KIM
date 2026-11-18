// The Nudge job (ADR 0002). Called every few minutes by pg_cron, it asks the
// core which Nudges to send and pushes them through Expo's push service.
// Each Nudge is logged before it is sent, so a Card is nudged at most once
// for a due date, even if two runs overlap.
import { createClient } from "@supabase/supabase-js";
import {
  NEWLY_DUE_MS,
  NUDGE_CHANNEL_ID,
  nudgeMessage,
  planNudges,
  type NudgeCandidate,
  type NudgeLanguage,
  type PlannedNudge,
  type SentNudge,
} from "../_shared/nudges.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH_SIZE = 100;
/** Keeps `in (...)` filters within URL length limits. */
const QUERY_CHUNK_SIZE = 200;

type CandidateRow = {
  user_id: string;
  linked: boolean;
  card_id: string;
  cue: string;
  due_at: string;
  archived: boolean;
};

type PushToken = { token: string; user_id: string; language: NudgeLanguage };

type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } };

/** The secret keys this project accepts, new style and legacy. */
function secretKeys(): string[] {
  const keys: string[] = [];
  const named = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (named) keys.push(...Object.values(JSON.parse(named) as Record<string, string>));
  for (const name of ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const key = Deno.env.get(name);
    if (key) keys.push(key);
  }
  return keys;
}

function presentedKey(request: Request): string | undefined {
  return (
    request.headers.get("apikey") ??
    request.headers.get("Authorization")?.replace(/^Bearer /, "") ??
    undefined
  );
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}

Deno.serve(async (request) => {
  const keys = secretKeys();
  const key = presentedKey(request);
  const url = Deno.env.get("SUPABASE_URL");
  if (!url || keys.length === 0) {
    return Response.json({ error: "Server misconfigured" }, { status: 500 });
  }
  if (!key || !keys.includes(key)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(url, keys[0]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date();

  // The newly due Cards, by Account.
  const { data: candidates, error: candidatesError } = await admin.rpc(
    "nudge_candidates",
    {
      due_after: new Date(now.getTime() - NEWLY_DUE_MS).toISOString(),
      due_by: now.toISOString(),
    },
  );
  if (candidatesError) throw candidatesError;
  const byUser = groupBy(candidates as CandidateRow[], ({ user_id }) => user_id);

  // The Nudges already sent for those Cards.
  const sent: SentNudge[] = [];
  const cardIds = (candidates as CandidateRow[]).map(({ card_id }) => card_id);
  for (const ids of chunks(cardIds, QUERY_CHUNK_SIZE)) {
    const { data, error } = await admin
      .from("nudges")
      .select("card_id, due_at")
      .in("card_id", ids);
    if (error) throw error;
    for (const row of data) {
      sent.push({ cardId: row.card_id, dueAt: new Date(row.due_at) });
    }
  }
  const sentByCard = groupBy(sent, ({ cardId }) => cardId);

  const planned: (PlannedNudge & { userId: string })[] = [];
  for (const [userId, rows] of byUser) {
    const cards: NudgeCandidate[] = rows.map((row) => ({
      id: row.card_id,
      cue: row.cue,
      dueAt: new Date(row.due_at),
      archived: row.archived,
    }));
    const nudges = planNudges({
      linked: rows[0]!.linked,
      cards,
      sent: cards.flatMap(({ id }) => sentByCard.get(id) ?? []),
      now,
    });
    for (const nudge of nudges) planned.push({ ...nudge, userId });
  }
  if (planned.length === 0) return Response.json({ sent: 0 });

  // Logging claims each Nudge: a row another run already wrote is skipped
  // and not returned, so only this run's Nudges are sent.
  const { data: claimed, error: claimError } = await admin
    .from("nudges")
    .upsert(
      planned.map(({ userId, cardId, dueAt }) => ({
        user_id: userId,
        card_id: cardId,
        due_at: dueAt.toISOString(),
        sent_at: now.toISOString(),
      })),
      { onConflict: "card_id,due_at", ignoreDuplicates: true },
    )
    .select("card_id");
  if (claimError) throw claimError;
  const claimedIds = new Set(claimed.map(({ card_id }) => card_id));
  const toSend = planned.filter(({ cardId }) => claimedIds.has(cardId));

  const tokens: PushToken[] = [];
  const userIds = [...new Set(toSend.map(({ userId }) => userId))];
  for (const ids of chunks(userIds, QUERY_CHUNK_SIZE)) {
    const { data, error } = await admin
      .from("push_tokens")
      .select("token, user_id, language")
      .in("user_id", ids);
    if (error) throw error;
    tokens.push(...(data as PushToken[]));
  }
  const tokensByUser = groupBy(tokens, ({ user_id }) => user_id);

  const messages = toSend.flatMap(({ userId, cardId, cue }) =>
    (tokensByUser.get(userId) ?? []).map(({ token, language }) => ({
      to: token,
      ...nudgeMessage(cue, language),
      // Tapping the Nudge opens this Card's Review.
      data: { cardId },
      channelId: NUDGE_CHANNEL_ID,
      sound: "default",
    })),
  );

  const unregistered: string[] = [];
  let failures = 0;
  for (const batch of chunks(messages, EXPO_BATCH_SIZE)) {
    // A Nudge is logged before it is sent, so one that fails here is lost
    // rather than risk sending it twice; the Card still waits in the app.
    let response: Response;
    try {
      response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });
    } catch (error) {
      console.error("Expo push unreachable", error);
      failures += batch.length;
      continue;
    }
    if (!response.ok) {
      console.error("Expo push failed", response.status, await response.text());
      failures += batch.length;
      continue;
    }
    const { data: tickets } = (await response.json()) as { data: ExpoTicket[] };
    tickets.forEach((ticket, index) => {
      if (ticket.status === "ok") return;
      failures += 1;
      if (ticket.details?.error === "DeviceNotRegistered") {
        unregistered.push(batch[index]!.to);
      } else {
        console.error("Nudge not accepted", ticket.message);
      }
    });
  }

  // The app was uninstalled or its token replaced: stop sending there.
  for (const tokens of chunks(unregistered, QUERY_CHUNK_SIZE)) {
    const { error } = await admin.from("push_tokens").delete().in("token", tokens);
    if (error) console.error("Could not forget push tokens", error);
  }

  return Response.json({
    nudges: toSend.length,
    messages: messages.length,
    failures,
  });
});
