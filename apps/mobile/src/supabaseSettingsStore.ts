import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from "@kim/core";
import { supabase } from "./supabase";

type SettingsRow = { new_cards_in_quiz_mode: boolean };

function toSettings(row: SettingsRow | null): Settings {
  return row
    ? { newCardsInQuizMode: row.new_cards_in_quiz_mode }
    : { ...DEFAULT_SETTINGS };
}

export const supabaseSettingsStore: SettingsStore = {
  async get() {
    const { data, error } = await supabase
      .from("settings")
      .select("new_cards_in_quiz_mode")
      .maybeSingle();
    if (error) throw error;
    return toSettings(data);
  },

  async update(changes) {
    if (changes.newCardsInQuizMode === undefined) return supabaseSettingsStore.get();
    // The Account's row is created on its first change. The user id comes
    // from the column default, which the insert policy checks.
    const { data, error } = await supabase
      .from("settings")
      .upsert(
        { new_cards_in_quiz_mode: changes.newCardsInQuizMode },
        { onConflict: "user_id" },
      )
      .select("new_cards_in_quiz_mode")
      .single();
    if (error) throw error;
    return toSettings(data);
  },
};
