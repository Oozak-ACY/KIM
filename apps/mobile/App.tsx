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
  matchingCards,
  tagsInUse,
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
  const [searchText, setSearchText] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>();

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
  const tags = tagsInUse(cards);
  // The chosen Tag can vanish when it is removed from its last Card.
  const activeTag = tags.find((tag) => tag === selectedTag);

  return (
    <View style={styles.fill}>
      <Text style={styles.title}>{t.cardsTitle}</Text>
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
          <CardRow card={item} due={dueIds.has(item.id)} onTagsSaved={load} />
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
}: {
  card: Card;
  due: boolean;
  onTagsSaved: () => Promise<void>;
}) {
  const [editingTags, setEditingTags] = useState(false);

  return (
    <View style={styles.card}>
      <Text style={styles.cue}>{card.cue}</Text>
      <Text style={styles.essence}>{card.essence}</Text>
      <Text style={styles.due}>{due ? t.dueNow : t.nextDue(card.dueAt)}</Text>
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
