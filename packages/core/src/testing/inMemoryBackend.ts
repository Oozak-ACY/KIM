import {
  DEFAULT_SETTINGS,
  type AccountStore,
  type Card,
  type CardStore,
  type NudgeLanguage,
  type PushTokenStore,
  type Review,
  type Settings,
  type SettingsStore,
  type SignInMethod,
} from "../index";

type StoredAccount = { id: string; identities: Set<string>; anonymous: boolean };
type Owned<T> = T & { userId: string };

/**
 * A stand-in for the KIM server shared by several devices. On a device,
 * Google answers as the person holding it, and email links are
 * opened with `openEmailLink`.
 */
export function inMemoryBackend() {
  const users = new Map<string, StoredAccount>();
  let cards: Owned<Card>[] = [];
  let reviews: Owned<Review>[] = [];
  let captures: Owned<{ cardId: string; capturedAt: Date }>[] = [];
  const settingsByUser = new Map<string, Settings>();
  let pushTokens: { token: string; userId: string; language: NudgeLanguage }[] =
    [];
  let nextId = 1;

  function newUser(anonymous: boolean): StoredAccount {
    const user = { id: `user-${nextId++}`, identities: new Set<string>(), anonymous };
    users.set(user.id, user);
    return user;
  }

  function ownerOf(identity: string): StoredAccount | undefined {
    return [...users.values()].find((user) => user.identities.has(identity));
  }

  function strip<T>({ userId: _, ...rest }: Owned<T>): T {
    return rest as T;
  }

  function device(person: string) {
    let user = newUser(true);
    const emailLinks = new Map<string, () => void>();
    let lastEmailLink: string | undefined;

    function sendEmailLink(complete: () => void): "email-sent" {
      lastEmailLink = `kim://email-link/${nextId++}`;
      emailLinks.set(lastEmailLink, complete);
      return "email-sent";
    }

    function identityOf(method: SignInMethod): string {
      return method.provider === "email"
        ? `email:${method.email.toLowerCase()}`
        : `${method.provider}:${person}`;
    }

    function signInTo(identity: string) {
      let owner = ownerOf(identity);
      if (!owner) {
        owner = newUser(false);
        owner.identities.add(identity);
      }
      user = owner;
    }

    const cardStore: CardStore = {
      async add(card) {
        const stored = { ...card, id: String(nextId++) };
        cards.push({ ...stored, userId: user.id });
        return stored;
      },
      async capture(card) {
        const stored = await cardStore.add(card);
        captures.push({
          cardId: stored.id,
          capturedAt: card.createdAt,
          userId: user.id,
        });
        return stored;
      },
      async listCaptures(since) {
        return captures
          .filter(({ userId, capturedAt }) => userId === user.id && capturedAt >= since)
          .map(({ capturedAt }) => capturedAt);
      },
      async list() {
        return cards.filter(({ userId }) => userId === user.id).map(strip<Card>);
      },
      async update(cardId, changes) {
        const index = cards.findIndex(
          ({ id, userId }) => id === cardId && userId === user.id,
        );
        const card = cards[index];
        if (!card) throw new Error(`Card ${cardId} not found`);
        cards[index] = { ...card, ...changes };
        return strip<Card>(cards[index]);
      },
      async recordReview(card, review) {
        const index = cards.findIndex(
          ({ id, userId }) => id === card.id && userId === user.id,
        );
        if (index === -1) throw new Error(`Card ${card.id} not found`);
        const stored = cards[index] as Owned<Card>;
        cards[index] = {
          ...stored,
          dueAt: card.dueAt,
          schedule: card.schedule,
          quizTurn: card.quizTurn,
        };
        reviews.push({ ...review, userId: user.id });
      },
      async remove(cardId) {
        const mine = ({ userId }: { userId: string }) => userId === user.id;
        cards = cards.filter((card) => !(mine(card) && card.id === cardId));
        reviews = reviews.filter(
          (review) => !(mine(review) && review.cardId === cardId),
        );
      },
      async listReviews(cardId) {
        return reviews
          .filter((review) => review.cardId === cardId && review.userId === user.id)
          .map(strip<Review>);
      },
    };

    const settings: SettingsStore = {
      async get() {
        return { ...(settingsByUser.get(user.id) ?? DEFAULT_SETTINGS) };
      },
      async update(changes) {
        const updated = { ...(await settings.get()), ...changes };
        settingsByUser.set(user.id, updated);
        return { ...updated };
      },
    };

    const pushTokenStore: PushTokenStore = {
      async register(token, language) {
        pushTokens = [
          ...pushTokens.filter((stored) => stored.token !== token),
          { token, userId: user.id, language },
        ];
      },
    };

    const accounts: AccountStore = {
      async current() {
        return { id: user.id, linked: !user.anonymous };
      },
      async link(method) {
        const identity = identityOf(method);
        const owner = ownerOf(identity);
        if (owner && owner !== user) return "taken";
        const linking = user;
        const complete = () => {
          linking.identities.add(identity);
          linking.anonymous = false;
        };
        if (method.provider === "email") return sendEmailLink(complete);
        complete();
        return "done";
      },
      async signIn(method) {
        const identity = identityOf(method);
        if (method.provider === "email") {
          return sendEmailLink(() => signInTo(identity));
        }
        signInTo(identity);
        return "done";
      },
      async completeEmailLink(link) {
        const complete = emailLinks.get(link);
        if (!complete) return false;
        emailLinks.delete(link);
        complete();
        return true;
      },
      async deleteAccount() {
        const deleted = user.id;
        users.delete(deleted);
        cards = cards.filter(({ userId }) => userId !== deleted);
        reviews = reviews.filter(({ userId }) => userId !== deleted);
        captures = captures.filter(({ userId }) => userId !== deleted);
        settingsByUser.delete(deleted);
        pushTokens = pushTokens.filter(({ userId }) => userId !== deleted);
        user = newUser(true);
      },
    };

    return {
      cards: cardStore,
      accounts,
      settings,
      pushTokens: pushTokenStore,
      /** The last link emailed from this device, for the test to open. */
      lastEmailLink() {
        if (!lastEmailLink) throw new Error("No email link was sent");
        return lastEmailLink;
      },
    };
  }

  return {
    device,
    /** The phones registered for Nudges, across all users. */
    pushTokens() {
      return pushTokens.map((stored) => ({ ...stored }));
    },
  };
}
