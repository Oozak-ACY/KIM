import Constants from "expo-constants";
import { getCalendars, getLocales } from "expo-localization";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { NUDGE_CHANNEL_ID, nudgeLanguage, type NudgeLanguage } from "@kim/core";
import { t } from "./i18n";

// A Nudge that arrives while KIM is open still shows.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** The language Nudges are written in on this phone, as the app speaks it. */
export function phoneLanguage(): NudgeLanguage {
  return nudgeLanguage(
    getLocales().flatMap(({ languageCode }) => (languageCode ? [languageCode] : [])),
  );
}

/** This phone's time zone, which Nudges follow until the user chooses one. */
export function phoneTimeZone(): string {
  return (
    getCalendars()[0]?.timeZone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC"
  );
}

/**
 * Asks for permission to notify, then returns this phone's push token, or
 * undefined when the user refused or the build cannot receive push.
 */
export async function phonePushToken(): Promise<string | undefined> {
  // Android only asks for permission once a channel exists.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(NUDGE_CHANNEL_ID, {
      name: t.nudgeChannel,
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) return undefined;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn("No EAS projectId in app.json: this build cannot receive Nudges.");
    return undefined;
  }
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

/**
 * What a tapped Nudge opens: one Card's Review, or for a grouped Nudge the
 * run of due Cards. Undefined when the response is not a tap on a Nudge.
 */
export type NudgeTarget = { kind: "card"; cardId: string } | { kind: "due" };

export function nudgeTarget(
  response: Notifications.NotificationResponse,
): NudgeTarget | undefined {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
    return undefined;
  }
  const { cardId, due } = response.notification.request.content.data ?? {};
  if (typeof cardId === "string") return { kind: "card", cardId };
  if (due === true) return { kind: "due" };
  return undefined;
}
