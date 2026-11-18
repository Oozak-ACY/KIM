import {
  DEFAULT_SETTINGS,
  type NudgeWindow,
  type Settings,
  type SettingsStore,
} from "@kim/core";
import { supabase } from "./supabase";

type SettingsRow = {
  new_cards_in_quiz_mode: boolean;
  nudges_on: boolean;
  nudge_windows: NudgeWindow[];
  daily_nudge_cap: number;
  time_zone: string | null;
};

const COLUMNS =
  "new_cards_in_quiz_mode, nudges_on, nudge_windows, daily_nudge_cap, time_zone";

function toSettings(row: SettingsRow | null): Settings {
  return row
    ? {
        newCardsInQuizMode: row.new_cards_in_quiz_mode,
        nudgesOn: row.nudges_on,
        nudgeWindows: row.nudge_windows.map(({ start, end }) => ({ start, end })),
        dailyNudgeCap: row.daily_nudge_cap,
        timeZone: row.time_zone,
      }
    : { ...DEFAULT_SETTINGS };
}

function toRow(changes: Partial<Settings>): Partial<SettingsRow> {
  return {
    ...(changes.newCardsInQuizMode !== undefined && {
      new_cards_in_quiz_mode: changes.newCardsInQuizMode,
    }),
    ...(changes.nudgesOn !== undefined && { nudges_on: changes.nudgesOn }),
    ...(changes.nudgeWindows !== undefined && {
      nudge_windows: changes.nudgeWindows,
    }),
    ...(changes.dailyNudgeCap !== undefined && {
      daily_nudge_cap: changes.dailyNudgeCap,
    }),
    ...(changes.timeZone !== undefined && { time_zone: changes.timeZone }),
  };
}

export const supabaseSettingsStore: SettingsStore = {
  async get() {
    const { data, error } = await supabase
      .from("settings")
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return toSettings(data);
  },

  async update(changes) {
    const row = toRow(changes);
    if (Object.keys(row).length === 0) return supabaseSettingsStore.get();
    // The Account's row is created on its first change, with the defaults
    // for the rest. The user id comes from the column default, which the
    // insert policy checks.
    const { data, error } = await supabase
      .from("settings")
      .upsert(row, { onConflict: "user_id" })
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return toSettings(data);
  },
};
