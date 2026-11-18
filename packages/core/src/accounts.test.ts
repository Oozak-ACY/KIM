import { describe, expect, it } from "vitest";
import { createCore } from "./index";
import { inMemoryBackend } from "./testing/inMemoryBackend";

function setup() {
  const backend = inMemoryBackend();
  const clock = { now: () => new Date("2026-01-15T09:00:00.000Z") };
  const device = (person: string) => {
    const connection = backend.device(person);
    return {
      ...connection,
      core: createCore({
        clock,
        cards: connection.cards,
        accounts: connection.accounts,
        settings: connection.settings,
        pushTokens: connection.pushTokens,
      }),
    };
  };
  return { backend, device };
}

const CARD = { cue: "What is KIM?", essence: "A memory companion." };

describe("accounts", () => {
  it("starts a new device on an anonymous account that is not linked", async () => {
    const { device } = setup();
    const { core } = device("alice");

    expect(await core.account()).toMatchObject({ linked: false });
  });

  it("links the anonymous account with Google and keeps its Cards and their schedules", async () => {
    const { device } = setup();
    const { core } = device("alice");
    const created = await core.createCard(CARD);
    if (!created.ok) throw new Error("Card refused");
    const reviewed = await core.recordReview({
      card: created.card,
      mode: "recall",
      outcome: "remembered",
      channel: "app",
    });

    const result = await core.connect({ provider: "google" });

    expect(result).toEqual({ ok: true, status: "linked" });
    expect(await core.account()).toMatchObject({ linked: true });
    expect(await core.listCards()).toEqual([reviewed]);
    expect(await core.listReviews(reviewed.id)).toHaveLength(1);
  });

  it("signs a second device in to the account already linked with Google and shows the same Cards", async () => {
    const { device } = setup();
    const phone = device("alice");
    await phone.core.createCard(CARD);
    await phone.core.connect({ provider: "google" });
    const tablet = device("alice");

    const result = await tablet.core.connect({ provider: "google" });

    expect(result).toEqual({ ok: true, status: "signed-in" });
    expect(await tablet.core.account()).toMatchObject({ linked: true });
    expect(await tablet.core.listCards()).toEqual(await phone.core.listCards());
  });

  it("brings the Cards made anonymously on the second device into the account it signs in to", async () => {
    const { device } = setup();
    const phone = device("alice");
    await phone.core.connect({ provider: "google" });
    const tablet = device("alice");
    const created = await tablet.core.createCard({
      cue: "Made on the tablet",
      essence: "Before signing in.",
    });
    if (!created.ok) throw new Error("Card refused");

    await tablet.core.connect({ provider: "google" });

    const { id: _, ...madeOnTablet } = created.card;
    expect(await phone.core.listCards()).toMatchObject([madeOnTablet]);
  });

  it("brings anonymous Cards along when the email sign-in link is opened", async () => {
    const { device } = setup();
    const phone = device("alice");
    await phone.core.connect({ provider: "email", email: "alice@example.com" });
    await phone.core.completeEmailLink(phone.lastEmailLink());
    const tablet = device("alice");
    await tablet.core.createCard(CARD);

    const result = await tablet.core.connect({
      provider: "email",
      email: "alice@example.com",
    });
    expect(result).toEqual({ ok: true, status: "email-sent" });
    expect(await tablet.core.account()).toMatchObject({ linked: false });

    await tablet.core.completeEmailLink(tablet.lastEmailLink());

    expect(await tablet.core.account()).toMatchObject({ linked: true });
    expect(await phone.core.listCards()).toMatchObject([CARD]);
  });

  it("keeps the Cards in place when an email link only confirms linking", async () => {
    const { device } = setup();
    const { core, lastEmailLink } = device("alice");
    await core.createCard(CARD);

    await core.connect({ provider: "email", email: "alice@example.com" });
    await core.completeEmailLink(lastEmailLink());

    expect(await core.account()).toMatchObject({ linked: true });
    expect(await core.listCards()).toMatchObject([CARD]);
  });

  it("does not move a linked account's Cards when switching to another account", async () => {
    const { device } = setup();
    const carolPhone = device("carol");
    await carolPhone.core.connect({ provider: "google" });
    const shared = device("bob");
    await shared.core.connect({ provider: "google" });
    await shared.core.createCard(CARD);
    await carolPhone.core.connect({ provider: "email", email: "carol@example.com" });
    await carolPhone.core.completeEmailLink(carolPhone.lastEmailLink());
    await shared.core.connect({ provider: "email", email: "carol@example.com" });
    await shared.core.completeEmailLink(shared.lastEmailLink());

    expect(await carolPhone.core.listCards()).toEqual([]);
  });

  it("refuses an email address without an @ and sends no link", async () => {
    const { device } = setup();
    const { core, lastEmailLink } = device("alice");

    const result = await core.connect({ provider: "email", email: " alice " });

    expect(result).toEqual({ ok: false, problem: "email-invalid" });
    expect(lastEmailLink).toThrow();
  });

  it("trims the email address before sending the link", async () => {
    const { device } = setup();
    const phone = device("alice");
    await phone.core.connect({ provider: "email", email: "alice@example.com" });
    await phone.core.completeEmailLink(phone.lastEmailLink());
    const tablet = device("alice");

    await tablet.core.connect({ provider: "email", email: " alice@example.com " });
    await tablet.core.completeEmailLink(tablet.lastEmailLink());

    expect(await tablet.core.account()).toEqual(await phone.core.account());
  });

  it("deletes the account with its Cards and Reviews, everywhere, and starts afresh", async () => {
    const { device } = setup();
    const phone = device("alice");
    const created = await phone.core.createCard(CARD);
    if (!created.ok) throw new Error("Card refused");
    await phone.core.recordReview({
      card: created.card,
      mode: "recall",
      outcome: "forgotten",
      channel: "app",
    });
    await phone.core.connect({ provider: "google" });
    const before = await phone.core.account();

    await phone.core.deleteAccount();

    const after = await phone.core.account();
    expect(after).toMatchObject({ linked: false });
    expect(after.id).not.toBe(before.id);
    expect(await phone.core.listCards()).toEqual([]);
    expect(await phone.core.listReviews(created.card.id)).toEqual([]);
    const tablet = device("alice");
    await tablet.core.connect({ provider: "google" });
    expect(await tablet.core.listCards()).toEqual([]);
  });

  it("leaves other accounts alone when deleting one", async () => {
    const { device } = setup();
    const alice = device("alice");
    const bob = device("bob");
    await alice.core.connect({ provider: "google" });
    await bob.core.connect({ provider: "google" });
    await bob.core.createCard(CARD);

    await alice.core.deleteAccount();

    expect(await bob.core.listCards()).toMatchObject([CARD]);
  });
});
