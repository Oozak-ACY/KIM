// The Nudge job (ADR 0002). Called every few minutes by pg_cron, it asks the
// core which Nudges to send and pushes them through Expo's push service.
// Each Nudge is logged before it is sent, so a Card is nudged at most once
// for a due date, even if two runs overlap.
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_NUDGE_SETTINGS,
  NUDGE_CHANNEL_ID,
  nudgeGroupMessage,
  nudgeMessage,
  planNudges,
  type NudgeCandidate,
  type NudgedCard,
  type NudgeLanguage,
  type NudgeSettings,
  type NudgeWindow,
  type PlannedNudge,
  type SentNudge,
} from "../_shared/nudges.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH_SIZE = 100;
/** Keeps `in (...)` filters within URL length limits. */
const QUERY_CHUNK_SIZE = 200;
/** Covers the user's local day, whatever their time zone. */
const SENT_LOOKBACK_MS = 48 * 60 * 60 * 1000;

type CandidateRow = {
  user_id: string;
  linked: boolean;
  card_id: string;
  cue: string;
  due_at: string;
  archived: boolean;
};

type SettingsRow = {
  user_id: string;
  nudges_on: boolean;
  nudge_windows: NudgeWindow[];
  daily_nudge_cap: number;
  time_zone: string | null;
};

type PushToken = { token: string; user_id: string; language: NudgeLanguage };

/** A Nudge planned for an Account. */
type Outgoing = {
  userId: string;
  nudge: PlannedNudge;
};

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

function nudgedCards(nudge: PlannedNudge): NudgedCard[] {
  return nudge.kind === "card" ? [nudge] : nudge.cards;
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

  // The due Cards not yet nudged, by Account.
  const { data: candidates, error: candidatesError } = await admin.rpc(
    "nudge_candidates",
    { due_by: now.toISOString() },
  );
  if (candidatesError) throw candidatesError;
  const byUser = groupBy(candidates as CandidateRow[], ({ user_id }) => user_id);
  const userIds = [...byUser.keys()];

  // Their choices about Nudges, and the Nudges they had lately, which the
  // daily cap counts.
  const settingsByUser = new Map<string, NudgeSettings>();
  const sent: (SentNudge & { userId: string })[] = [];
  const sentSince = new Date(now.getTime() - SENT_LOOKBACK_MS).toISOString();
  for (const ids of chunks(userIds, QUERY_CHUNK_SIZE)) {
    const settings = await admin
      .from("settings")
      .select("user_id, nudges_on, nudge_windows, daily_nudge_cap, time_zone")
      .in("user_id", ids);
    if (settings.error) throw settings.error;
    for (const row of settings.data as SettingsRow[]) {
      settingsByUser.set(row.user_id, {
        nudgesOn: row.nudges_on,
        nudgeWindows: row.nudge_windows,
        dailyNudgeCap: row.daily_nudge_cap,
        timeZone: row.time_zone,
      });
    }

    const nudges = await admin
      .from("nudges")
      .select("user_id, card_id, due_at, sent_at, grouped")
      .in("user_id", ids)
      .gte("sent_at", sentSince);
    if (nudges.error) throw nudges.error;
    for (const row of nudges.data) {
      sent.push({
        userId: row.user_id,
        cardId: row.card_id,
        dueAt: new Date(row.due_at),
        sentAt: new Date(row.sent_at),
        grouped: row.grouped,
      });
    }
  }
  const sentByUser = groupBy(sent, ({ userId }) => userId);

  const planned: Outgoing[] = [];
  for (const [userId, rows] of byUser) {
    const cards: NudgeCandidate[] = rows.map((row) => ({
      id: row.card_id,
      cue: row.cue,
      dueAt: new Date(row.due_at),
      archived: row.archived,
    }));
    const nudges = planNudges({
      linked: rows[0]!.linked,
      settings: settingsByUser.get(userId) ?? DEFAULT_NUDGE_SETTINGS,
      cards,
      sent: sentByUser.get(userId) ?? [],
      now,
    });
    for (const nudge of nudges) planned.push({ userId, nudge });
  }
  if (planned.length === 0) return Response.json({ nudges: 0 });

  // Logging claims each Card: a row another run already wrote is skipped
  // and not returned, so only this run's Nudges are sent.
  const { data: claimed, error: claimError } = await admin
    .from("nudges")
    .upsert(
      planned.flatMap(({ userId, nudge }) =>
        nudgedCards(nudge).map(({ cardId, dueAt }) => ({
          user_id: userId,
          card_id: cardId,
          due_at: dueAt.toISOString(),
          sent_at: now.toISOString(),
          grouped: nudge.kind === "group",
        })),
      ),
      { onConflict: "card_id,due_at", ignoreDuplicates: true },
    )
    .select("card_id");
  if (claimError) throw claimError;
  const claimedIds = new Set(claimed.map(({ card_id }) => card_id));
  const toSend = planned.flatMap(({ userId, nudge }): Outgoing[] => {
    if (nudge.kind === "card") {
      return claimedIds.has(nudge.cardId) ? [{ userId, nudge }] : [];
    }
    const cards = nudge.cards.filter(({ cardId }) => claimedIds.has(cardId));
    return cards.length > 0 ? [{ userId, nudge: { kind: "group", cards } }] : [];
  });

  const tokens: PushToken[] = [];
  const sendingTo = [...new Set(toSend.map(({ userId }) => userId))];
  for (const ids of chunks(sendingTo, QUERY_CHUNK_SIZE)) {
    const { data, error } = await admin
      .from("push_tokens")
      .select("token, user_id, language")
      .in("user_id", ids);
    if (error) throw error;
    tokens.push(...(data as PushToken[]));
  }
  const tokensByUser = groupBy(tokens, ({ user_id }) => user_id);

  const messages = toSend.flatMap(({ userId, nudge }) =>
    (tokensByUser.get(userId) ?? []).map(({ token, language }) => ({
      to: token,
      ...(nudge.kind === "card"
        ? {
            ...nudgeMessage(nudge.cue, language),
            // Tapping the Nudge opens this Card's Review.
            data: { cardId: nudge.cardId },
          }
        : {
            ...nudgeGroupMessage(nudge.cards.length, language),
            // Tapping the grouped Nudge opens the run of due Cards.
            data: { due: true },
          }),
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
