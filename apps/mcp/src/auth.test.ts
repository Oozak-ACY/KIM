import { describe, expect, it } from "vitest";
import { authInfoFromClaims } from "./auth";

const LINKED = {
  sub: "user-1",
  exp: 1_800_000_000,
  is_anonymous: false,
  client_id: "claude",
};

describe("who may use the KIM connector", () => {
  it("lets a linked Account in, as itself", () => {
    expect(authInfoFromClaims("token", LINKED)).toMatchObject({
      token: "token",
      clientId: "claude",
      expiresAt: 1_800_000_000,
      extra: { userId: "user-1" },
    });
  });

  it("turns an anonymous Account away", () => {
    expect(() =>
      authInfoFromClaims("token", { ...LINKED, is_anonymous: true }),
    ).toThrow(/linked/);
  });

  it("turns away a token that does not say whether its Account is anonymous", () => {
    const { is_anonymous: _, ...claims } = LINKED;

    expect(() => authInfoFromClaims("token", claims)).toThrow(/linked/);
  });
});
