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
  account: string;
  signIn: string;
  back: string;
  accountPitch: string;
  accountLinked: string;
  continueWithApple: string;
  continueWithGoogle: string;
  emailLabel: string;
  emailPlaceholder: string;
  sendEmailLink: string;
  emailSent: (email: string) => string;
  emailInvalid: string;
  emailLinkFailed: string;
  linked: string;
  signedIn: string;
  signInFailed: string;
  deleteAccount: string;
  deleteAccountWarning: string;
  accountDeleted: string;
  deleteFailed: string;
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
  account: "Account",
  signIn: "Sign in",
  back: "Back",
  accountPitch:
    "Sign in to keep your Cards safe and see them on all your devices. The Cards you already have stay with you.",
  accountLinked: "You are signed in. Your Cards are kept on all your devices.",
  continueWithApple: "Continue with Apple",
  continueWithGoogle: "Continue with Google",
  emailLabel: "Email",
  emailPlaceholder: "you@example.com",
  sendEmailLink: "Email me a sign-in link",
  emailSent: (email) =>
    `We sent a link to ${email}. Open it on this device to finish signing in.`,
  emailInvalid: "Enter a valid email address.",
  emailLinkFailed: "This sign-in link did not work. It may have expired: ask for a new one.",
  linked: "You are signed in, and your Cards are kept.",
  signedIn: "You are signed in. Your Cards are here.",
  signInFailed: "Signing in failed. Check your connection and try again.",
  deleteAccount: "Delete my account",
  deleteAccountWarning:
    "This permanently deletes your account with all your Cards, Reviews and settings, on every device. It cannot be undone.",
  accountDeleted: "Your account and all its data are deleted.",
  deleteFailed: "The account could not be deleted. Check your connection and try again.",
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
  account: "Compte",
  signIn: "Se connecter",
  back: "Retour",
  accountPitch:
    "Connectez-vous pour garder vos Cartes en sécurité et les retrouver sur tous vos appareils. Les Cartes que vous avez déjà restent avec vous.",
  accountLinked: "Vous êtes connecté. Vos Cartes vous suivent sur tous vos appareils.",
  continueWithApple: "Continuer avec Apple",
  continueWithGoogle: "Continuer avec Google",
  emailLabel: "E-mail",
  emailPlaceholder: "vous@exemple.fr",
  sendEmailLink: "Recevoir un lien de connexion",
  emailSent: (email) =>
    `Nous avons envoyé un lien à ${email}. Ouvrez-le sur cet appareil pour terminer la connexion.`,
  emailInvalid: "Saisissez une adresse e-mail valide.",
  emailLinkFailed: "Ce lien de connexion n'a pas fonctionné. Il a peut-être expiré : demandez-en un nouveau.",
  linked: "Vous êtes connecté, et vos Cartes sont conservées.",
  signedIn: "Vous êtes connecté. Vos Cartes sont là.",
  signInFailed: "La connexion a échoué. Vérifiez votre connexion et réessayez.",
  deleteAccount: "Supprimer mon compte",
  deleteAccountWarning:
    "Votre compte sera supprimé définitivement avec toutes vos Cartes, Révisions et réglages, sur tous vos appareils. C'est irréversible.",
  accountDeleted: "Votre compte et toutes ses données sont supprimés.",
  deleteFailed: "Impossible de supprimer le compte. Vérifiez votre connexion et réessayez.",
};

const messages: Record<string, Messages> = { en, fr };

// The device's preferred language that KIM speaks, in the device's order.
const language = getLocales().find(
  ({ languageCode }) => languageCode && languageCode in messages,
)?.languageCode;

export const t = messages[language ?? "en"] ?? en;
