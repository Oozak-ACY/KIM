import type { CardProblem } from "@kim/core";
import { CUE_MAX_CHARACTERS, ESSENCE_MAX_CHARACTERS, ESSENCE_MAX_LINES } from "@kim/core";
import { getLocales } from "expo-localization";

type Messages = {
  cardsTitle: string;
  noCards: string;
  noMatchingCards: string;
  searchCards: string;
  editTags: string;
  closeTags: string;
  addTag: string;
  removeTag: (tag: string) => string;
  tagsSaveFailed: string;
  newCard: string;
  cueLabel: string;
  cuePlaceholder: string;
  essenceLabel: string;
  essencePlaceholder: string;
  charactersLeft: (count: number) => string;
  linesLeft: (count: number) => string;
  save: string;
  cancel: string;
  loadFailed: string;
  saveFailed: string;
  retry: string;
  dueNow: string;
  nextDue: (date: Date) => string;
  reviewDueCards: (count: number) => string;
  reviewProgress: (position: number, total: number) => string;
  revealEssence: string;
  remembered: string;
  forgotten: string;
  stopReview: string;
  reviewSaveFailed: string;
  problems: Record<CardProblem, string>;
};

const DUE_DATE_FORMAT = { dateStyle: "medium", timeStyle: "short" } as const;

const en: Messages = {
  cardsTitle: "Your Cards",
  noCards: "No Cards yet. Add what you want to keep in mind.",
  noMatchingCards: "No Card matches this search.",
  searchCards: "Search your Cards",
  editTags: "Edit Tags",
  closeTags: "Done",
  addTag: "Add a Tag",
  removeTag: (tag) => `Remove the Tag ${tag}`,
  tagsSaveFailed: "The Tags could not be saved. Check your connection and try again.",
  newCard: "New Card",
  cueLabel: "Cue",
  cuePlaceholder: "How does nuclear fusion work?",
  essenceLabel: "Essence",
  essencePlaceholder: `The key idea, in up to ${ESSENCE_MAX_LINES} lines`,
  charactersLeft: (count) =>
    count >= 0
      ? `${count} ${count === 1 ? "character" : "characters"} left`
      : `${-count} over the limit`,
  linesLeft: (count) =>
    count >= 0
      ? `${count} ${count === 1 ? "line" : "lines"} left`
      : `${-count} ${count === -1 ? "line" : "lines"} too many`,
  save: "Save",
  cancel: "Cancel",
  loadFailed: "Your Cards could not be loaded. Check your connection.",
  saveFailed: "The Card could not be saved. Check your connection and try again.",
  retry: "Try again",
  dueNow: "Due now",
  nextDue: (date) =>
    `Next due ${date.toLocaleString("en", DUE_DATE_FORMAT)}`,
  reviewDueCards: (count) =>
    `Review ${count} due ${count === 1 ? "Card" : "Cards"}`,
  reviewProgress: (position, total) => `Card ${position} of ${total}`,
  revealEssence: "Show the Essence",
  remembered: "I remembered",
  forgotten: "I'd forgotten",
  stopReview: "Stop",
  reviewSaveFailed: "Your answer could not be saved. Check your connection and try again.",
  problems: {
    "cue-missing": "Write a Cue.",
    "cue-too-long": `Keep the Cue to ${CUE_MAX_CHARACTERS} characters.`,
    "essence-missing": "Write an Essence.",
    "essence-too-long": `Keep the Essence to ${ESSENCE_MAX_CHARACTERS} characters.`,
    "essence-too-many-lines": `Keep the Essence to ${ESSENCE_MAX_LINES} lines.`,
  },
};

const fr: Messages = {
  cardsTitle: "Vos Cartes",
  noCards: "Aucune Carte pour l'instant. Ajoutez ce que vous voulez garder en tête.",
  noMatchingCards: "Aucune Carte ne correspond à cette recherche.",
  searchCards: "Rechercher dans vos Cartes",
  editTags: "Modifier les Tags",
  closeTags: "Terminé",
  addTag: "Ajouter un Tag",
  removeTag: (tag) => `Retirer le Tag ${tag}`,
  tagsSaveFailed: "Impossible d'enregistrer les Tags. Vérifiez votre connexion et réessayez.",
  newCard: "Nouvelle Carte",
  cueLabel: "Repère",
  cuePlaceholder: "Comment fonctionne la fusion nucléaire ?",
  essenceLabel: "Essentiel",
  essencePlaceholder: `L'idée clé, en ${ESSENCE_MAX_LINES} lignes maximum`,
  charactersLeft: (count) =>
    count >= 0
      ? `${count} ${count <= 1 ? "caractère restant" : "caractères restants"}`
      : `${-count} en trop`,
  linesLeft: (count) =>
    count >= 0
      ? `${count} ${count <= 1 ? "ligne restante" : "lignes restantes"}`
      : `${-count} ${count === -1 ? "ligne" : "lignes"} en trop`,
  save: "Enregistrer",
  cancel: "Annuler",
  loadFailed: "Impossible de charger vos Cartes. Vérifiez votre connexion.",
  saveFailed: "Impossible d'enregistrer la Carte. Vérifiez votre connexion et réessayez.",
  retry: "Réessayer",
  dueNow: "À revoir maintenant",
  nextDue: (date) =>
    `Prochaine échéance : ${date.toLocaleString("fr", DUE_DATE_FORMAT)}`,
  reviewDueCards: (count) =>
    count === 1 ? "Réviser 1 Carte à revoir" : `Réviser ${count} Cartes à revoir`,
  reviewProgress: (position, total) => `Carte ${position} sur ${total}`,
  revealEssence: "Afficher l'Essentiel",
  remembered: "Je m'en souvenais",
  forgotten: "J'avais oublié",
  stopReview: "Arrêter",
  reviewSaveFailed: "Impossible d'enregistrer votre réponse. Vérifiez votre connexion et réessayez.",
  problems: {
    "cue-missing": "Écrivez un Repère.",
    "cue-too-long": `Limitez le Repère à ${CUE_MAX_CHARACTERS} caractères.`,
    "essence-missing": "Écrivez un Essentiel.",
    "essence-too-long": `Limitez l'Essentiel à ${ESSENCE_MAX_CHARACTERS} caractères.`,
    "essence-too-many-lines": `Limitez l'Essentiel à ${ESSENCE_MAX_LINES} lignes.`,
  },
};

const messages: Record<string, Messages> = { en, fr };

// The device's preferred language that KIM speaks, in the device's order.
const language = getLocales().find(
  ({ languageCode }) => languageCode && languageCode in messages,
)?.languageCode;

export const t = messages[language ?? "en"] ?? en;
