import type { AccountStore, LinkAttempt, SignInMethod } from "@kim/core";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { ensureSession, supabase } from "./supabase";

/** Where Google sends the user back after the browser sign-in. */
const OAUTH_REDIRECT = Linking.createURL("auth/oauth");
/** Where the emailed link opens the app. */
const EMAIL_REDIRECT = Linking.createURL("auth/email");

/** Whether a link that opened the app is one we emailed to sign in. */
export function isEmailLink(link: string): boolean {
  return link.startsWith(EMAIL_REDIRECT);
}

/** Supabase puts the result in the query or the fragment, depending on the flow. */
function authParams(url: string): URLSearchParams {
  const [beforeHash = "", hash = ""] = url.split("#", 2);
  const params = new URLSearchParams(beforeHash.split("?", 2)[1] ?? "");
  new URLSearchParams(hash).forEach((value, key) => params.set(key, value));
  return params;
}

async function exchangeCode(url: string): Promise<LinkAttempt> {
  const params = authParams(url);
  if (params.get("error_code") === "identity_already_exists") return "taken";
  const code = params.get("code");
  if (!code) {
    throw new Error(params.get("error_description") ?? "Sign-in failed");
  }
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
  return "done";
}

async function signInInBrowser(
  start: Promise<{ data: { url: string | null }; error: Error | null }>,
): Promise<LinkAttempt> {
  const { data, error } = await start;
  if (error) throw error;
  if (!data.url) throw new Error("No sign-in page to open");
  const result = await WebBrowser.openAuthSessionAsync(data.url, OAUTH_REDIRECT);
  if (result.type !== "success") return "cancelled";
  return exchangeCode(result.url);
}

export const supabaseAccountStore: AccountStore = {
  async current() {
    await ensureSession();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const user = data.session?.user;
    if (!user) throw new Error("No session");
    return { id: user.id, linked: user.is_anonymous !== true };
  },

  async link(method: SignInMethod) {
    if (method.provider === "email") {
      const { error } = await supabase.auth.updateUser(
        { email: method.email },
        { emailRedirectTo: EMAIL_REDIRECT },
      );
      if (error?.code === "email_exists") return "taken";
      if (error) throw error;
      return "email-sent";
    }

    return signInInBrowser(
      supabase.auth.linkIdentity({
        provider: method.provider,
        options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true },
      }),
    );
  },

  async signIn(method: SignInMethod) {
    if (method.provider === "email") {
      const { error } = await supabase.auth.signInWithOtp({
        email: method.email,
        options: { emailRedirectTo: EMAIL_REDIRECT, shouldCreateUser: false },
      });
      if (error) throw error;
      return "email-sent";
    }

    const outcome = await signInInBrowser(
      supabase.auth.signInWithOAuth({
        provider: method.provider,
        options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true },
      }),
    );
    if (outcome === "taken") throw new Error("Sign-in refused");
    return outcome;
  },

  async completeEmailLink(link) {
    if (!isEmailLink(link)) return false;
    const params = authParams(link);
    const code = params.get("code");
    if (!code) return false;
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error === null;
  },

  async deleteAccount() {
    const { error } = await supabase.rpc("delete_account");
    if (error) throw error;
    // The session belongs to a user that no longer exists.
    await supabase.auth.signOut({ scope: "local" });
    await ensureSession();
  },
};
