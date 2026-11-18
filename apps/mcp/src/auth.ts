import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

/** The claims of a Supabase Auth access token the connector relies on. */
export type KimClaims = {
  sub?: unknown;
  exp?: unknown;
  is_anonymous?: unknown;
  client_id?: unknown;
};

/**
 * Who the verified token speaks for. Only a linked Account may connect an
 * assistant, so an anonymous one, or a token that does not say, is turned
 * away and the assistant asks the user to sign in again.
 */
export function authInfoFromClaims(token: string, claims: KimClaims): AuthInfo {
  if (claims.is_anonymous !== false) {
    throw new InvalidTokenError(
      "Only a linked KIM account can connect an assistant: sign in with Google or email in the KIM app first.",
    );
  }
  if (typeof claims.sub !== "string" || typeof claims.exp !== "number") {
    throw new InvalidTokenError("The token does not name a KIM account.");
  }
  return {
    token,
    clientId: typeof claims.client_id === "string" ? claims.client_id : "",
    scopes: [],
    expiresAt: claims.exp,
    extra: { userId: claims.sub },
  };
}
