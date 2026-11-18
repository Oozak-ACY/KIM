import { createCore, type AccountStore, type KimCore } from "@kim/core";
import { supabaseCardStore, supabaseSettingsStore } from "@kim/supabase";
import { createClient } from "@supabase/supabase-js";

function unavailable(): never {
  throw new Error("Not available through the KIM connector");
}

/**
 * The core acting as the user the access token speaks for. Row level
 * security scopes every query to them. The connector only lets linked
 * Accounts in, and never signs in, links or deletes one.
 */
export function connectorCore({
  supabaseUrl,
  supabaseKey,
  token,
  userId,
}: {
  supabaseUrl: string;
  supabaseKey: string;
  token: string;
  userId: string;
}): KimCore {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const accounts: AccountStore = {
    current: async () => ({ id: userId, linked: true }),
    link: unavailable,
    signIn: unavailable,
    completeEmailLink: unavailable,
    deleteAccount: unavailable,
  };
  return createCore({
    clock: { now: () => new Date() },
    cards: supabaseCardStore(supabase),
    accounts,
    settings: supabaseSettingsStore(supabase),
    pushTokens: { register: unavailable },
  });
}
