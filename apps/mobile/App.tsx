import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  createCore,
  essenceRoom,
  type Card,
  type CardProblem,
  type RecallOutcome,
} from "@kim/core";
import { t } from "./src/i18n";
import { ensureSession } from "./src/supabase";
import { supabaseCardStore } from "./src/supabaseCardStore";

const core = createCore({
  clock: { now: () => new Date() },
  cards: supabaseCardStore,
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      await ensureSession();
      const [listed, due] = await Promise.all([
        core.listCards(),
        core.dueCards(),
      ]);
      setCards(listed);
      setDueCards(due);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Cards come due while the app sits in the background. Left alone during a
  // Review, whose list of Cards must not move under the user.
  useEffect(() => {
    if (reviewing) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => subscription.remove();
  }, [load, reviewing]);

  if (loadFailed) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>{t.loadFailed}</Text>
        <Button label={t.retry} onPress={load} />
      </View>
    );
  }

  if (cards === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (creating) {
    return (
      <NewCard
        onCancel={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void load();
        }}
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

  return (
    <View style={styles.fill}>
      <Text style={styles.title}>{t.cardsTitle}</Text>
      {dueCards.length > 0 && (
        <Button
          label={t.reviewDueCards(dueCards.length)}
          onPress={() => setReviewing(true)}
        />
      )}
      <FlatList
        style={styles.fill}
        data={[...dueCards, ...cards.filter((card) => !dueIds.has(card.id))]}
        keyExtractor={(card) => card.id}
        ListEmptyComponent={<Text style={styles.message}>{t.noCards}</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cue}>{item.cue}</Text>
            <Text style={styles.essence}>{item.essence}</Text>
            <Text style={styles.due}>
              {dueIds.has(item.id) ? t.dueNow : t.nextDue(item.dueAt)}
            </Text>
          </View>
        )}
      />
      <Button label={t.newCard} onPress={() => setCreating(true)} />
    </View>
  );
}

function Reviews({ cards, onDone }: { cards: Card[]; onDone: () => void }) {
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const card = cards[position];

  if (!card) return null;

  const answer = async (outcome: RecallOutcome) => {
    setSaving(true);
    setSaveFailed(false);
    try {
      await core.recordReview({
        card,
        mode: "recall",
        outcome,
        channel: "app",
      });
      if (position + 1 === cards.length) {
        onDone();
      } else {
        setPosition(position + 1);
        setRevealed(false);
      }
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.fill}>
      <Text style={styles.progress}>
        {t.reviewProgress(position + 1, cards.length)}
      </Text>
      <View style={styles.centered}>
        <Text style={styles.reviewCue}>{card.cue}</Text>
        {revealed && <Text style={styles.reviewEssence}>{card.essence}</Text>}
      </View>
      {saveFailed && <Text style={styles.problem}>{t.reviewSaveFailed}</Text>}
      {revealed ? (
        <>
          <Button
            label={t.remembered}
            onPress={() => answer("remembered")}
            disabled={saving}
          />
          <Button
            label={t.forgotten}
            onPress={() => answer("forgotten")}
            disabled={saving}
          />
        </>
      ) : (
        <Button label={t.revealEssence} onPress={() => setRevealed(true)} />
      )}
      <Button label={t.stopReview} onPress={onDone} disabled={saving} quiet />
    </View>
  );
}

function NewCard({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [cue, setCue] = useState("");
  const [essence, setEssence] = useState("");
  const [problems, setProblems] = useState<CardProblem[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const room = essenceRoom(essence);

  async function save() {
    setSaving(true);
    setSaveFailed(false);
    try {
      const result = await core.createCard({ cue, essence });
      if (result.ok) {
        onCreated();
      } else {
        setProblems(result.problems);
      }
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.form}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{t.newCard}</Text>
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
      {problems.map((problem) => (
        <Text key={problem} style={styles.problem}>
          {t.problems[problem]}
        </Text>
      ))}
      {saveFailed && <Text style={styles.problem}>{t.saveFailed}</Text>}
      <View style={styles.fill} />
      <Button label={t.save} onPress={save} disabled={saving} />
      <Button label={t.cancel} onPress={onCancel} quiet />
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
  message: { fontSize: 16, color: "#555", textAlign: "center", margin: 16 },
  card: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ccc",
  },
  cue: { fontSize: 17, fontWeight: "600", marginBottom: 4 },
  essence: { fontSize: 15, color: "#333" },
  due: { fontSize: 13, color: "#555", marginTop: 4 },
  progress: { fontSize: 14, color: "#555", marginVertical: 16 },
  reviewCue: { fontSize: 24, fontWeight: "700", textAlign: "center" },
  reviewEssence: {
    fontSize: 18,
    color: "#333",
    textAlign: "center",
    marginTop: 16,
  },
  label: { fontSize: 14, fontWeight: "600", marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  essenceInput: { minHeight: 120, textAlignVertical: "top" },
  room: { fontSize: 13, color: "#555", marginTop: 4 },
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
