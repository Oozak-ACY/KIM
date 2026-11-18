import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLinkingURL } from "expo-linking";
import * as Notifications from "expo-notifications";
import {
  createCore,
  DAILY_NUDGE_CAP_MAX,
  essenceRoom,
  isTimeZone,
  matchingCards,
  reviewStyle,
  tagsInUse,
  type Account,
  type Card,
  QUIZ_QUESTIONS_MAX,
  type CardProblem,
  type QuizQuestion,
  type ReviewAnswer,
  type NudgeWindow,
  type Settings,
  type SignInMethod,
} from "@kim/core";
import { t } from "./src/i18n";
import {
  nudgeTarget,
  phoneLanguage,
  phonePushToken,
  phoneTimeZone,
} from "./src/nudges";
import { ensureSession } from "./src/supabase";
import { isEmailLink, supabaseAccountStore } from "./src/supabaseAccountStore";
import { supabaseCardStore } from "./src/supabaseCardStore";
import { supabasePushTokenStore } from "./src/supabasePushTokenStore";
import { supabaseSettingsStore } from "./src/supabaseSettingsStore";

const core = createCore({
  clock: { now: () => new Date() },
  cards: supabaseCardStore,
  accounts: supabaseAccountStore,
  settings: supabaseSettingsStore,
  pushTokens: supabasePushTokenStore,
});

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="auto" />
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Cards />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Cards() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [dueCards, setDueCards] = useState<Card[]>([]);
  const [account, setAccount] = useState<Account>();
  const [settings, setSettings] = useState<Settings>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [emailLinkFailed, setEmailLinkFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Card>();
  const [reviewing, setReviewing] = useState(false);
  const [managingAccount, setManagingAccount] = useState(false);
  const [changingSettings, setChangingSettings] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>();
  const [nudgedCard, setNudgedCard] = useState<Card>();
  /** Why a tapped Nudge opened no Review. */
  const [nudgeNotice, setNudgeNotice] = useState<string>();

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      await ensureSession();
      const [listed, due, current, chosen] = await Promise.all([
        core.listCards(),
        core.dueCards(),
        core.account(),
        core.settings(),
      ]);
      setCards(listed);
      setDueCards(due);
      setAccount(current);
      setSettings(chosen);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The link emailed to sign in opens the app. The hook repeats the launch
  // link after a reload, and a link only works once.
  const link = useLinkingURL();
  const openedLinks = useRef(new Set<string>());
  useEffect(() => {
    if (!link || !isEmailLink(link) || openedLinks.current.has(link)) return;
    openedLinks.current.add(link);
    setEmailLinkFailed(false);
    core
      .completeEmailLink(link)
      .then((completed) => {
        setEmailLinkFailed(!completed);
        if (completed) void load();
      })
      .catch(() => setEmailLinkFailed(true));
  }, [link, load]);

  // Nudges need a linked Account: once it is one, ask to notify and register
  // this phone. A failed attempt is tried again at the next load.
  const registeredFor = useRef<string>(undefined);
  useEffect(() => {
    if (!account?.linked || registeredFor.current === account.id) return;
    registeredFor.current = account.id;
    (async () => {
      const token = await phonePushToken();
      if (token) {
        await core.registerForNudges(token, phoneLanguage(), phoneTimeZone());
        // The phone's time zone may have become the Nudges' one.
        setSettings(await core.settings());
      }
    })().catch(() => {
      registeredFor.current = undefined;
    });
  }, [account]);

  // Tapping a Nudge, even one that launched the app, opens that Card's
  // Review, as long as the Card is still due. A grouped Nudge opens the run
  // of due Cards.
  const nudgeResponse = Notifications.useLastNotificationResponse();
  const openedNudges = useRef(new Set<string>());
  useEffect(() => {
    if (!nudgeResponse) return;
    const target = nudgeTarget(nudgeResponse);
    const nudge = nudgeResponse.notification.request.identifier;
    if (!target || openedNudges.current.has(nudge)) return;
    openedNudges.current.add(nudge);
    Notifications.clearLastNotificationResponse();
    setNudgeNotice(undefined);
    (async () => {
      await ensureSession();
      const due = await core.dueCards();
      if (target.kind === "due") {
        setDueCards(due);
        if (due.length > 0) setReviewing(true);
        else setNudgeNotice(t.nudgeNothingDue);
        return;
      }
      const card = due.find(({ id }) => id === target.cardId);
      if (card) setNudgedCard(card);
      else setNudgeNotice(t.nudgeCardGone);
    })().catch(() => setNudgeNotice(t.loadFailed));
  }, [nudgeResponse]);

  // Cards come due while the app sits in the background. Left alone during a
  // Review, whose list of Cards must not move under the user.
  const inReview = reviewing || nudgedCard !== undefined;
  useEffect(() => {
    if (inReview) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => subscription.remove();
  }, [load, inReview]);

  if (loadFailed) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>{t.loadFailed}</Text>
        <Button label={t.retry} onPress={load} />
      </View>
    );
  }

  if (cards === null || account === undefined || settings === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (nudgedCard) {
    return (
      <Reviews
        cards={[nudgedCard]}
        onDone={() => {
          setNudgedCard(undefined);
          void load();
        }}
      />
    );
  }

  if (creating || editing) {
    const close = () => {
      setCreating(false);
      setEditing(undefined);
    };
    return (
      <CardForm
        card={editing}
        startInQuizMode={settings.newCardsInQuizMode}
        onCancel={close}
        onDone={() => {
          close();
          void load();
        }}
      />
    );
  }

  if (managingAccount) {
    return (
      <AccountSettings
        account={account}
        onChanged={load}
        onClose={() => setManagingAccount(false)}
      />
    );
  }

  if (changingSettings) {
    return (
      <SettingsScreen
        settings={settings}
        onChanged={setSettings}
        onClose={() => setChangingSettings(false)}
      />
    );
  }

  if (reviewing) {
    return (
      <Reviews
        cards={dueCards}
        onDone={() => {
          setReviewing(false);
          void load();
        }}
      />
    );
  }

  const dueIds = new Set(dueCards.map((card) => card.id));
  const tags = tagsInUse(cards);
  // The chosen Tag can vanish when it is removed from its last Card.
  const activeTag = tags.find((tag) => tag === selectedTag);

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <Text style={styles.title}>{t.cardsTitle}</Text>
        <View style={styles.headerActions}>
          <Chip label={t.settings} onPress={() => setChangingSettings(true)} />
          <Chip
            label={account.linked ? t.account : t.signIn}
            onPress={() => setManagingAccount(true)}
          />
        </View>
      </View>
      {emailLinkFailed && (
        <Text style={styles.problem}>{t.emailLinkFailed}</Text>
      )}
      {nudgeNotice !== undefined && (
        <Text style={styles.message}>{nudgeNotice}</Text>
      )}
      {dueCards.length > 0 && (
        <Button
          label={t.reviewDueCards(dueCards.length)}
          onPress={() => setReviewing(true)}
        />
      )}
      {cards.length > 0 && (
        <TextInput
          style={styles.input}
          value={searchText}
          onChangeText={setSearchText}
          placeholder={t.searchCards}
          accessibilityLabel={t.searchCards}
          autoCorrect={false}
        />
      )}
      {tags.length > 0 && (
        <ScrollView
          horizontal
          style={styles.tagFilter}
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
        >
          {tags.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              selected={tag === activeTag}
              onPress={() =>
                setSelectedTag(tag === activeTag ? undefined : tag)
              }
            />
          ))}
        </ScrollView>
      )}
      <FlatList
        style={styles.fill}
        data={matchingCards(
          [...dueCards, ...cards.filter((card) => !dueIds.has(card.id))],
          { text: searchText, tag: activeTag },
        )}
        keyExtractor={(card) => card.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.message}>
            {cards.length > 0 ? t.noMatchingCards : t.noCards}
          </Text>
        }
        renderItem={({ item }) => (
          <CardRow
            card={item}
            due={dueIds.has(item.id)}
            onTagsSaved={load}
            onEdit={() => setEditing(item)}
          />
        )}
      />
      <Button label={t.newCard} onPress={() => setCreating(true)} />
    </View>
  );
}

function CardRow({
  card,
  due,
  onTagsSaved,
  onEdit,
}: {
  card: Card;
  due: boolean;
  onTagsSaved: () => Promise<void>;
  onEdit: () => void;
}) {
  const [editingTags, setEditingTags] = useState(false);

  return (
    <View style={styles.card}>
      <Text style={styles.cue}>{card.cue}</Text>
      <Text style={styles.essence}>{card.essence}</Text>
      {card.hints !== "" && <Text style={styles.hints}>{card.hints}</Text>}
      <Text style={styles.due}>
        {card.archived ? t.archived : due ? t.dueNow : t.nextDue(card.dueAt)}
        {card.quizMode && ` · ${t.quizModeMarker}`}
      </Text>
      {editingTags ? (
        <TagEditor
          card={card}
          onSaved={onTagsSaved}
          onClose={() => setEditingTags(false)}
        />
      ) : (
        <View style={styles.tags}>
          {card.tags.map((tag) => (
            <Chip key={tag} label={tag} />
          ))}
          <Chip label={t.editTags} onPress={() => setEditingTags(true)} />
          <Chip label={t.editCard} onPress={onEdit} />
        </View>
      )}
    </View>
  );
}

function TagEditor({
  card,
  onSaved,
  onClose,
}: {
  card: Card;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [newTag, setNewTag] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save(tags: string[]) {
    setSaving(true);
    setSaveFailed(false);
    try {
      await core.setTags(card.id, tags);
      setNewTag("");
      // Stay disabled until card.tags is fresh: each save replaces the whole
      // list, so a save built on stale Tags would undo this one.
      await onSaved();
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <View style={styles.tags}>
        {card.tags.map((tag) => (
          <Chip
            key={tag}
            label={`${tag} ×`}
            accessibilityLabel={t.removeTag(tag)}
            disabled={saving}
            onPress={() => save(card.tags.filter((other) => other !== tag))}
          />
        ))}
        <Chip label={t.closeTags} disabled={saving} onPress={onClose} />
      </View>
      <TextInput
        style={styles.input}
        value={newTag}
        onChangeText={setNewTag}
        onSubmitEditing={() => {
          if (newTag.trim() !== "") void save([...card.tags, newTag]);
        }}
        placeholder={t.addTag}
        accessibilityLabel={t.addTag}
        editable={!saving}
        returnKeyType="done"
      />
      {saveFailed && <Text style={styles.problem}>{t.tagsSaveFailed}</Text>}
    </View>
  );
}

function Chip({
  label,
  accessibilityLabel,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: selected === true }}
      onPress={onPress}
      disabled={disabled || !onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function AccountSettings({
  account,
  onChanged,
  onClose,
}: {
  account: Account;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [problem, setProblem] = useState<string>();

  async function run(
    step: () => Promise<{ notice?: string; problem?: string }>,
    failure: string,
  ) {
    setBusy(true);
    setNotice(undefined);
    setProblem(undefined);
    try {
      const outcome = await step();
      setNotice(outcome.notice);
      setProblem(outcome.problem);
    } catch {
      setProblem(failure);
    } finally {
      setBusy(false);
    }
  }

  const connect = (method: SignInMethod) =>
    run(async () => {
      const result = await core.connect(method);
      if (!result.ok) return { problem: t.emailInvalid };
      switch (result.status) {
        case "email-sent":
          return { notice: t.emailSent(email.trim()) };
        case "linked":
          await onChanged();
          return { notice: t.linked };
        case "signed-in":
          await onChanged();
          return { notice: t.signedIn };
        case "cancelled":
          return {};
      }
    }, t.signInFailed);

  const deleteAccount = () =>
    run(async () => {
      await core.deleteAccount();
      await onChanged();
      return { notice: t.accountDeleted };
    }, t.deleteFailed);

  function confirmDelete() {
    Alert.alert(t.deleteAccount, t.deleteAccountWarning, [
      { text: t.cancel, style: "cancel" },
      {
        text: t.deleteAccount,
        style: "destructive",
        onPress: () => void deleteAccount(),
      },
    ]);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.form}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{t.account}</Text>
      {account.linked ? (
        <>
          <Text style={styles.message}>{t.accountLinked}</Text>
          <Button
            label={t.deleteAccount}
            onPress={confirmDelete}
            disabled={busy}
            quiet
          />
        </>
      ) : (
        <>
          <Text style={styles.message}>{t.accountPitch}</Text>
          <Button
            label={t.continueWithGoogle}
            onPress={() => connect({ provider: "google" })}
            disabled={busy}
          />
          <Text style={styles.label}>{t.emailLabel}</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder={t.emailPlaceholder}
            accessibilityLabel={t.emailLabel}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!busy}
          />
          <Button
            label={t.sendEmailLink}
            onPress={() => connect({ provider: "email", email })}
            disabled={busy}
          />
        </>
      )}
      {busy && <ActivityIndicator />}
      {notice && <Text style={styles.message}>{notice}</Text>}
      {problem && <Text style={styles.problem}>{problem}</Text>}
      <View style={styles.fill} />
      <Button label={t.back} onPress={onClose} disabled={busy} quiet />
    </ScrollView>
  );
}

/** Nudge window times move by half an hour. */
const WINDOW_STEP_MINUTES = 30;
const MINUTES_A_DAY = 24 * 60;
const NEW_NUDGE_WINDOW: NudgeWindow = { start: 12 * 60, end: 13 * 60 };

function clockTime(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * The window with one end moved by a step, around the clock. An end never
 * lands on the other, which would leave the window empty.
 */
function movedWindow(
  window: NudgeWindow,
  end: "start" | "end",
  direction: 1 | -1,
): NudgeWindow {
  const move = (minutes: number) =>
    (minutes + direction * WINDOW_STEP_MINUTES + MINUTES_A_DAY) % MINUTES_A_DAY;
  const other = (end === "start" ? window.end : window.start) % MINUTES_A_DAY;
  let moved = move(window[end] % MINUTES_A_DAY);
  if (moved === other) moved = move(moved);
  return { ...window, [end]: moved };
}

function SettingsScreen({
  settings,
  onChanged,
  onClose,
}: {
  settings: Settings;
  onChanged: (settings: Settings) => void;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const phoneZone = phoneTimeZone();
  const timeZone = settings.timeZone ?? phoneZone;
  const [timeZoneText, setTimeZoneText] = useState(timeZone);
  const [timeZoneUnknown, setTimeZoneUnknown] = useState(false);
  // The time zone can be saved while the screen is open, such as the
  // phone's when it registers for Nudges.
  useEffect(() => {
    setTimeZoneText(timeZone);
    setTimeZoneUnknown(false);
  }, [timeZone]);

  async function change(changes: Partial<Settings>) {
    setSaving(true);
    setSaveFailed(false);
    try {
      onChanged(await core.changeSettings(changes));
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  function changeWindow(index: number, window: NudgeWindow | undefined) {
    const windows = [...settings.nudgeWindows];
    if (window) windows[index] = window;
    else windows.splice(index, 1);
    void change({ nudgeWindows: windows });
  }

  function chooseTimeZone(zone: string) {
    const chosen = zone.trim();
    setTimeZoneText(chosen);
    const known = isTimeZone(chosen);
    setTimeZoneUnknown(!known);
    if (known && chosen !== timeZone) void change({ timeZone: chosen });
  }

  return (
    <ScrollView
      contentContainerStyle={styles.form}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{t.settings}</Text>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t.newCardsInQuizMode}</Text>
        <Switch
          value={settings.newCardsInQuizMode}
          onValueChange={(on) => change({ newCardsInQuizMode: on })}
          disabled={saving}
          accessibilityLabel={t.newCardsInQuizMode}
        />
      </View>
      <Text style={styles.room}>{t.newCardsInQuizModeHelp}</Text>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t.nudgesOn}</Text>
        <Switch
          value={settings.nudgesOn}
          onValueChange={(on) => change({ nudgesOn: on })}
          disabled={saving}
          accessibilityLabel={t.nudgesOn}
        />
      </View>
      <Text style={styles.room}>{t.nudgesOnHelp}</Text>

      {settings.nudgesOn && (
        <>
          <Text style={styles.label}>{t.nudgeWindows}</Text>
          {settings.nudgeWindows.map((window, index) => (
            <View key={index} style={styles.nudgeWindow}>
              <Stepper
                label={t.nudgeWindowStart}
                value={clockTime(window.start)}
                onLess={() => changeWindow(index, movedWindow(window, "start", -1))}
                onMore={() => changeWindow(index, movedWindow(window, "start", 1))}
                disabled={saving}
              />
              <Stepper
                label={t.nudgeWindowEnd}
                value={clockTime(window.end)}
                onLess={() => changeWindow(index, movedWindow(window, "end", -1))}
                onMore={() => changeWindow(index, movedWindow(window, "end", 1))}
                disabled={saving}
              />
              {settings.nudgeWindows.length > 1 && (
                <Chip
                  label={t.removeNudgeWindow}
                  onPress={() => changeWindow(index, undefined)}
                />
              )}
            </View>
          ))}
          <Text style={styles.room}>{t.nudgeWindowsHelp}</Text>
          <Button
            label={t.addNudgeWindow}
            onPress={() =>
              change({ nudgeWindows: [...settings.nudgeWindows, NEW_NUDGE_WINDOW] })
            }
            disabled={saving}
            quiet
          />

          <Text style={styles.label}>{t.dailyNudgeCap}</Text>
          <Stepper
            label={t.dailyNudgeCap}
            value={String(settings.dailyNudgeCap)}
            onLess={() => change({ dailyNudgeCap: settings.dailyNudgeCap - 1 })}
            onMore={() => change({ dailyNudgeCap: settings.dailyNudgeCap + 1 })}
            lessDisabled={settings.dailyNudgeCap <= 1}
            moreDisabled={settings.dailyNudgeCap >= DAILY_NUDGE_CAP_MAX}
            disabled={saving}
          />
          <Text style={styles.room}>{t.dailyNudgeCapHelp}</Text>

          <Text style={styles.label}>{t.timeZone}</Text>
          <TextInput
            style={styles.input}
            value={timeZoneText}
            onChangeText={setTimeZoneText}
            onEndEditing={() => chooseTimeZone(timeZoneText)}
            accessibilityLabel={t.timeZone}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!saving}
          />
          {timeZoneUnknown && (
            <Text style={styles.problem}>{t.timeZoneUnknown}</Text>
          )}
          {timeZone !== phoneZone && (
            <Button
              label={t.usePhoneTimeZone(phoneZone)}
              onPress={() => chooseTimeZone(phoneZone)}
              disabled={saving}
              quiet
            />
          )}
        </>
      )}

      {saveFailed && <Text style={styles.problem}>{t.settingsSaveFailed}</Text>}
      <View style={styles.fill} />
      <Button label={t.back} onPress={onClose} disabled={saving} quiet />
    </ScrollView>
  );
}

/** A value with buttons to lower and raise it. */
function Stepper({
  label,
  value,
  onLess,
  onMore,
  disabled,
  lessDisabled,
  moreDisabled,
}: {
  label: string;
  value: string;
  onLess: () => void;
  onMore: () => void;
  disabled?: boolean;
  lessDisabled?: boolean;
  moreDisabled?: boolean;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.lower(label)}
        onPress={onLess}
        disabled={disabled || lessDisabled}
        style={styles.stepperButton}
      >
        <Text style={styles.stepperButtonLabel}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.raise(label)}
        onPress={onMore}
        disabled={disabled || moreDisabled}
        style={styles.stepperButton}
      >
        <Text style={styles.stepperButtonLabel}>+</Text>
      </Pressable>
    </View>
  );
}

function Reviews({ cards, onDone }: { cards: Card[]; onDone: () => void }) {
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Shown right after a Review that earned the Card an archive proposal. */
  const [proposingArchive, setProposingArchive] = useState(false);
  const card = cards[position];

  if (!card) return null;

  const style = reviewStyle(card);

  const next = () => {
    if (position + 1 === cards.length) {
      onDone();
    } else {
      setPosition(position + 1);
      setRevealed(false);
    }
  };

  const save = async (step: () => Promise<void>) => {
    setSaving(true);
    setSaveFailed(false);
    try {
      await step();
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const record = (answer: ReviewAnswer) =>
    save(async () => {
      const reviewed = await core.recordReview({
        card,
        channel: "app",
        ...answer,
      });
      if (reviewed.archiveProposed) setProposingArchive(true);
      else next();
    });

  const decideArchive = (accept: boolean) =>
    save(async () => {
      await (accept
        ? core.archiveCard(card.id)
        : core.declineArchiveProposal(card.id));
      setProposingArchive(false);
      next();
    });

  if (proposingArchive) {
    return (
      <View style={styles.fill}>
        <View style={styles.centered}>
          <Text style={styles.reviewQuizCue}>{card.cue}</Text>
          <Text style={styles.reviewCue}>{t.archiveProposal}</Text>
        </View>
        {saveFailed && (
          <Text style={styles.problem}>{t.cardActionFailed}</Text>
        )}
        <Button
          label={t.acceptArchiveProposal}
          onPress={() => decideArchive(true)}
          disabled={saving}
        />
        <Button
          label={t.declineArchiveProposal}
          onPress={() => decideArchive(false)}
          disabled={saving}
        />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Text style={styles.progress}>
        {t.reviewProgress(position + 1, cards.length)}
      </Text>
      <View style={styles.centered}>
        {style.mode === "quiz" ? (
          <>
            <Text style={styles.reviewQuizCue}>{card.cue}</Text>
            <Text style={styles.reviewCue}>{style.quizQuestion.question}</Text>
          </>
        ) : (
          <Text style={styles.reviewCue}>{card.cue}</Text>
        )}
        {revealed && (
          <>
            {style.mode === "quiz" && (
              <Text style={styles.reviewAnswer}>
                {style.quizQuestion.answer}
              </Text>
            )}
            <Text style={styles.reviewEssence}>{card.essence}</Text>
            {card.hints !== "" && (
              <Text style={styles.reviewHints}>{card.hints}</Text>
            )}
          </>
        )}
      </View>
      {saveFailed && <Text style={styles.problem}>{t.reviewSaveFailed}</Text>}
      {!revealed ? (
        <Button
          label={style.mode === "quiz" ? t.revealAnswer : t.revealEssence}
          onPress={() => setRevealed(true)}
        />
      ) : style.mode === "quiz" ? (
        <View style={styles.grades}>
          {(["forgot", "hard", "good"] as const).map((outcome) => (
            <View key={outcome} style={styles.fill}>
              <Button
                label={t.quizOutcomes[outcome]}
                onPress={() => record({ mode: "quiz", outcome })}
                disabled={saving}
              />
            </View>
          ))}
        </View>
      ) : (
        <>
          <Button
            label={t.remembered}
            onPress={() => record({ mode: "recall", outcome: "remembered" })}
            disabled={saving}
          />
          <Button
            label={t.forgotten}
            onPress={() => record({ mode: "recall", outcome: "forgotten" })}
            disabled={saving}
          />
        </>
      )}
      <Button label={t.stopReview} onPress={onDone} disabled={saving} quiet />
    </View>
  );
}

/** Creates a Card, or edits one and offers the rest of its care. */
function CardForm({
  card,
  startInQuizMode,
  onCancel,
  onDone,
}: {
  card?: Card;
  startInQuizMode: boolean;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [cue, setCue] = useState(card?.cue ?? "");
  const [essence, setEssence] = useState(card?.essence ?? "");
  const [hints, setHints] = useState(card?.hints ?? "");
  const [quizMode, setQuizMode] = useState(card?.quizMode ?? startInQuizMode);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>(
    card?.quizQuestions ?? [],
  );
  const [problems, setProblems] = useState<CardProblem[]>([]);
  const [failure, setFailure] = useState<string>();
  const [saving, setSaving] = useState(false);
  const room = essenceRoom(essence);

  /** Runs a step and leaves the form once it says it is done. */
  async function run(step: () => Promise<boolean>, failed: string) {
    setSaving(true);
    setFailure(undefined);
    try {
      if (await step()) onDone();
    } catch {
      setFailure(failed);
    } finally {
      setSaving(false);
    }
  }

  const save = () =>
    run(async () => {
      const draft = { cue, essence, hints, quizQuestions, quizMode };
      const result = card
        ? await core.editCard(card.id, draft)
        : await core.createCard(draft);
      if (!result.ok) setProblems(result.problems);
      return result.ok;
    }, t.saveFailed);

  const act = (step: (cardId: string) => Promise<unknown>) => () => {
    if (!card) return;
    void run(async () => {
      await step(card.id);
      return true;
    }, t.cardActionFailed);
  };

  function confirm(title: string, warning: string, onConfirm: () => void) {
    Alert.alert(title, warning, [
      { text: t.cancel, style: "cancel" },
      { text: title, style: "destructive", onPress: onConfirm },
    ]);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.form}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{card ? t.editCard : t.newCard}</Text>
      <Text style={styles.label}>{t.cueLabel}</Text>
      <TextInput
        style={styles.input}
        value={cue}
        onChangeText={(text) => {
          setCue(text);
          setProblems([]);
        }}
        placeholder={t.cuePlaceholder}
        accessibilityLabel={t.cueLabel}
      />
      <Text style={styles.label}>{t.essenceLabel}</Text>
      <TextInput
        style={[styles.input, styles.essenceInput]}
        value={essence}
        onChangeText={(text) => {
          setEssence(text);
          setProblems([]);
        }}
        placeholder={t.essencePlaceholder}
        accessibilityLabel={t.essenceLabel}
        multiline
      />
      <Text
        style={[
          styles.room,
          (room.characters < 0 || room.lines < 0) && styles.over,
        ]}
      >
        {t.charactersLeft(room.characters)} · {t.linesLeft(room.lines)}
      </Text>
      <Text style={styles.label}>{t.hintsLabel}</Text>
      <TextInput
        style={styles.input}
        value={hints}
        onChangeText={(text) => {
          setHints(text);
          setProblems([]);
        }}
        placeholder={t.hintsPlaceholder}
        accessibilityLabel={t.hintsLabel}
        multiline
      />
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t.quizMode}</Text>
        <Switch
          value={quizMode}
          onValueChange={setQuizMode}
          accessibilityLabel={t.quizMode}
        />
      </View>
      {quizMode && quizQuestions.length === 0 && (
        <Text style={styles.room}>{t.quizModeNeedsQuestions}</Text>
      )}
      {quizQuestions.map((quizQuestion, index) => {
        const change = (changes: Partial<QuizQuestion>) => {
          setQuizQuestions(
            quizQuestions.map((other, at) =>
              at === index ? { ...other, ...changes } : other,
            ),
          );
          setProblems([]);
        };
        return (
          <View key={index} style={styles.quizQuestion}>
            <Text style={styles.label}>{t.quizQuestionLabel(index + 1)}</Text>
            <TextInput
              style={styles.input}
              value={quizQuestion.question}
              onChangeText={(question) => change({ question })}
              placeholder={t.quizQuestionPlaceholder}
              accessibilityLabel={t.quizQuestionLabel(index + 1)}
              multiline
            />
            <TextInput
              style={[styles.input, styles.quizAnswerInput]}
              value={quizQuestion.answer}
              onChangeText={(answer) => change({ answer })}
              placeholder={t.quizAnswerPlaceholder}
              accessibilityLabel={t.quizAnswerLabel(index + 1)}
              multiline
            />
            <View style={styles.tags}>
              <Chip
                label={t.removeQuizQuestion}
                accessibilityLabel={t.removeQuizQuestionNumber(index + 1)}
                onPress={() => {
                  setQuizQuestions(
                    quizQuestions.filter((_, at) => at !== index),
                  );
                  setProblems([]);
                }}
              />
            </View>
          </View>
        );
      })}
      {quizQuestions.length < QUIZ_QUESTIONS_MAX && (
        <View style={styles.tags}>
          <Chip
            label={t.addQuizQuestion}
            onPress={() =>
              setQuizQuestions([...quizQuestions, { question: "", answer: "" }])
            }
          />
        </View>
      )}
      {problems.map((problem) => (
        <Text key={problem} style={styles.problem}>
          {t.problems[problem]}
        </Text>
      ))}
      {failure && <Text style={styles.problem}>{failure}</Text>}
      <View style={styles.fill} />
      <Button label={t.save} onPress={save} disabled={saving} />
      {card && (
        <>
          <Button
            label={t.restartLearning}
            onPress={() =>
              confirm(
                t.restartLearning,
                t.restartLearningWarning,
                act(core.restartLearning),
              )
            }
            disabled={saving}
            quiet
          />
          <Button
            label={card.archived ? t.unarchive : t.archive}
            onPress={act(card.archived ? core.unarchiveCard : core.archiveCard)}
            disabled={saving}
            quiet
          />
          <Button
            label={t.deleteCard}
            onPress={() =>
              confirm(t.deleteCard, t.deleteCardWarning, act(core.deleteCard))
            }
            disabled={saving}
            quiet
          />
        </>
      )}
      <Button label={t.cancel} onPress={onCancel} disabled={saving} quiet />
    </ScrollView>
  );
}

function Button({
  label,
  onPress,
  disabled,
  quiet,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  quiet?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, quiet && styles.quietButton]}
    >
      <Text style={[styles.buttonLabel, quiet && styles.quietButtonLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff", paddingHorizontal: 16 },
  fill: { flex: 1 },
  form: { flexGrow: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "700", marginVertical: 16 },
  headerActions: { flexDirection: "row" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  message: { fontSize: 16, color: "#555", textAlign: "center", margin: 16 },
  card: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ccc",
  },
  cue: { fontSize: 17, fontWeight: "600", marginBottom: 4 },
  essence: { fontSize: 15, color: "#333" },
  hints: { fontSize: 14, color: "#555", fontStyle: "italic", marginTop: 4 },
  due: { fontSize: 13, color: "#555", marginTop: 4 },
  tagFilter: { flexGrow: 0, marginTop: 8 },
  tags: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 4,
  },
  chipSelected: { backgroundColor: "#222", borderColor: "#222" },
  chipLabel: { fontSize: 13, color: "#222" },
  chipLabelSelected: { color: "#fff" },
  progress: { fontSize: 14, color: "#555", marginVertical: 16 },
  reviewCue: { fontSize: 24, fontWeight: "700", textAlign: "center" },
  reviewQuizCue: {
    fontSize: 15,
    color: "#555",
    textAlign: "center",
    marginBottom: 8,
  },
  reviewAnswer: {
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 16,
  },
  grades: { flexDirection: "row", gap: 8 },
  reviewEssence: {
    fontSize: 18,
    color: "#333",
    textAlign: "center",
    marginTop: 16,
  },
  reviewHints: {
    fontSize: 16,
    color: "#555",
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 12,
  },
  label: { fontSize: 14, fontWeight: "600", marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
  },
  switchLabel: { fontSize: 16, flex: 1, marginRight: 12 },
  quizQuestion: { marginTop: 4 },
  quizAnswerInput: { marginTop: 8 },
  essenceInput: { minHeight: 120, textAlignVertical: "top" },
  room: { fontSize: 13, color: "#555", marginTop: 4 },
  nudgeWindow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    marginVertical: 4,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepperLabel: { fontSize: 14, color: "#555" },
  stepperButton: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperButtonLabel: { fontSize: 18 },
  stepperValue: {
    fontSize: 16,
    minWidth: 48,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  over: { color: "#b3261e" },
  problem: { fontSize: 14, color: "#b3261e", marginTop: 8 },
  button: {
    backgroundColor: "#222",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginVertical: 8,
  },
  quietButton: { backgroundColor: "transparent" },
  buttonLabel: { color: "#fff", fontSize: 16, fontWeight: "600" },
  quietButtonLabel: { color: "#222" },
});
