import type { CardProblem, QuizOutcome } from "@kim/core";
import {
  CUE_MAX_CHARACTERS,
  ESSENCE_MAX_CHARACTERS,
  ESSENCE_MAX_LINES,
  HINTS_MAX_CHARACTERS,
  QUIZ_QUESTIONS_MAX,
} from "@kim/core";
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
  hintsLabel: string;
  hintsPlaceholder: string;
  charactersLeft: (count: number) => string;
  linesLeft: (count: number) => string;
  save: string;
  cancel: string;
  loadFailed: string;
  saveFailed: string;
  retry: string;
  editCard: string;
  restartLearning: string;
  restartLearningWarning: string;
  archive: string;
  unarchive: string;
  archived: string;
  deleteCard: string;
  deleteCardWarning: string;
  cardActionFailed: string;
  dueNow: string;
  nextDue: (date: Date) => string;
  reviewDueCards: (count: number) => string;
  reviewProgress: (position: number, total: number) => string;
  revealEssence: string;
  remembered: string;
  forgotten: string;
  stopReview: string;
  reviewSaveFailed: string;
  archiveProposal: string;
  acceptArchiveProposal: string;
  declineArchiveProposal: string;
  problems: Record<CardProblem, string>;
  quizMode: string;
  quizModeMarker: string;
  quizModeNeedsQuestions: string;
  quizQuestionLabel: (number: number) => string;
  quizQuestionPlaceholder: string;
  quizAnswerLabel: (number: number) => string;
  quizAnswerPlaceholder: string;
  addQuizQuestion: string;
  removeQuizQuestion: string;
  removeQuizQuestionNumber: (number: number) => string;
  revealAnswer: string;
  quizOutcomes: Record<QuizOutcome, string>;
  settings: string;
  newCardsInQuizMode: string;
  newCardsInQuizModeHelp: string;
  settingsSaveFailed: string;
  account: string;
  signIn: string;
  back: string;
  accountPitch: string;
  accountLinked: string;
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
  nudgeChannel: string;
  nudgeCardGone: string;
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
  hintsLabel: "Hints (optional)",
  hintsPlaceholder: "A mnemonic, an analogy or an example",
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
  editCard: "Edit Card",
  restartLearning: "Restart learning",
  restartLearningWarning:
    "This Card will be scheduled again as if it were new, starting now. Its past Reviews are kept.",
  archive: "Archive",
  unarchive: "Unarchive",
  archived: "Archived",
  deleteCard: "Delete Card",
  deleteCardWarning:
    "This permanently deletes the Card and its Review history. It cannot be undone.",
  cardActionFailed: "That did not work. Check your connection and try again.",
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
  archiveProposal: "I think you know this one by heart now. Archive it, or keep reviewing it?",
  acceptArchiveProposal: "Archive it",
  declineArchiveProposal: "Keep reviewing",
  problems: {
    "cue-missing": "Write a Cue.",
    "cue-too-long": `Keep the Cue to ${CUE_MAX_CHARACTERS} characters.`,
    "essence-missing": "Write an Essence.",
    "essence-too-long": `Keep the Essence to ${ESSENCE_MAX_CHARACTERS} characters.`,
    "essence-too-many-lines": `Keep the Essence to ${ESSENCE_MAX_LINES} lines.`,
    "hints-too-long": `Keep the Hints to ${HINTS_MAX_CHARACTERS} characters.`,
    "too-many-quiz-questions": `Keep to ${QUIZ_QUESTIONS_MAX} Quiz questions.`,
    "quiz-question-missing": "Write each Quiz question, or remove it.",
    "quiz-answer-missing": "Write the expected answer to each Quiz question.",
  },
  quizMode: "Quiz mode",
  quizModeMarker: "Quiz",
  quizModeNeedsQuestions:
    "Add a Quiz question: until then, this Card is reviewed by its Cue.",
  quizQuestionLabel: (number) => `Quiz question ${number}`,
  quizQuestionPlaceholder: "A question about this Card",
  quizAnswerLabel: (number) => `Expected answer ${number}`,
  quizAnswerPlaceholder: "The answer you expect",
  addQuizQuestion: "Add a Quiz question",
  removeQuizQuestion: "Remove",
  removeQuizQuestionNumber: (number) => `Remove Quiz question ${number}`,
  revealAnswer: "Show the answer",
  quizOutcomes: { forgot: "Forgot", hard: "Hard", good: "Good" },
  settings: "Settings",
  newCardsInQuizMode: "New Cards start in Quiz mode",
  newCardsInQuizModeHelp:
    "You can still switch each Card between Quiz mode and Recall mode.",
  settingsSaveFailed:
    "The setting could not be saved. Check your connection and try again.",
  account: "Account",
  signIn: "Sign in",
  back: "Back",
  accountPitch:
    "Sign in to keep your Cards safe and see them on all your devices. The Cards you already have stay with you.",
  accountLinked: "You are signed in. Your Cards are kept on all your devices.",
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
  nudgeChannel: "Nudges",
  nudgeCardGone: "This Card is no longer due for now.",
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
  hintsLabel: "Indices (facultatif)",
  hintsPlaceholder: "Un moyen mnémotechnique, une analogie ou un exemple",
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
  editCard: "Modifier la Carte",
  restartLearning: "Recommencer l'apprentissage",
  restartLearningWarning:
    "Cette Carte sera reprogrammée comme une nouvelle Carte, à partir de maintenant. Ses Révisions passées sont conservées.",
  archive: "Archiver",
  unarchive: "Désarchiver",
  archived: "Archivée",
  deleteCard: "Supprimer la Carte",
  deleteCardWarning:
    "La Carte et son historique de Révisions seront supprimés définitivement. C'est irréversible.",
  cardActionFailed: "Cela n'a pas fonctionné. Vérifiez votre connexion et réessayez.",
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
  archiveProposal: "Je crois que vous la connaissez par cœur. L'archiver, ou continuer à la réviser ?",
  acceptArchiveProposal: "L'archiver",
  declineArchiveProposal: "Continuer à réviser",
  problems: {
    "cue-missing": "Écrivez un Repère.",
    "cue-too-long": `Limitez le Repère à ${CUE_MAX_CHARACTERS} caractères.`,
    "essence-missing": "Écrivez un Essentiel.",
    "essence-too-long": `Limitez l'Essentiel à ${ESSENCE_MAX_CHARACTERS} caractères.`,
    "essence-too-many-lines": `Limitez l'Essentiel à ${ESSENCE_MAX_LINES} lignes.`,
    "hints-too-long": `Limitez les Indices à ${HINTS_MAX_CHARACTERS} caractères.`,
    "too-many-quiz-questions": `Limitez-vous à ${QUIZ_QUESTIONS_MAX} questions de Quiz.`,
    "quiz-question-missing": "Écrivez chaque question de Quiz, ou retirez-la.",
    "quiz-answer-missing": "Écrivez la réponse attendue à chaque question de Quiz.",
  },
  quizMode: "Mode Quiz",
  quizModeMarker: "Quiz",
  quizModeNeedsQuestions:
    "Ajoutez une question de Quiz : d'ici là, cette Carte est révisée par son Repère.",
  quizQuestionLabel: (number) => `Question de Quiz ${number}`,
  quizQuestionPlaceholder: "Une question sur cette Carte",
  quizAnswerLabel: (number) => `Réponse attendue ${number}`,
  quizAnswerPlaceholder: "La réponse que vous attendez",
  addQuizQuestion: "Ajouter une question de Quiz",
  removeQuizQuestion: "Retirer",
  removeQuizQuestionNumber: (number) => `Retirer la question de Quiz ${number}`,
  revealAnswer: "Afficher la réponse",
  quizOutcomes: { forgot: "Oublié", hard: "Difficile", good: "Bien" },
  settings: "Réglages",
  newCardsInQuizMode: "Les nouvelles Cartes commencent en mode Quiz",
  newCardsInQuizModeHelp:
    "Vous pouvez toujours passer chaque Carte du mode Quiz au mode Rappel.",
  settingsSaveFailed:
    "Impossible d'enregistrer le réglage. Vérifiez votre connexion et réessayez.",
  account: "Compte",
  signIn: "Se connecter",
  back: "Retour",
  accountPitch:
    "Connectez-vous pour garder vos Cartes en sécurité et les retrouver sur tous vos appareils. Les Cartes que vous avez déjà restent avec vous.",
  accountLinked: "Vous êtes connecté. Vos Cartes vous suivent sur tous vos appareils.",
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
  nudgeChannel: "Nudges",
  nudgeCardGone: "Cette Carte n'est plus à réviser pour l'instant.",
};

const messages: Record<string, Messages> = { en, fr };

// The device's preferred language that KIM speaks, in the device's order.
const language = getLocales().find(
  ({ languageCode }) => languageCode && languageCode in messages,
)?.languageCode;

export const t = messages[language ?? "en"] ?? en;
