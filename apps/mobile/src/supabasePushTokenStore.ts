import type { PushTokenStore } from "@kim/core";
import { supabase } from "./supabase";

export const supabasePushTokenStore: PushTokenStore = {
  async register(token, language) {
    const { error } = await supabase.rpc("register_push_token", {
      push_token: token,
      push_language: language,
    });
    if (error) throw error;
  },
};
