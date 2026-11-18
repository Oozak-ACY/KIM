import Constants from "expo-constants";
import { getLocales } from "expo-localization";
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

/** The Card a tapped Nudge is about, if the response is a tap on a Nudge. */
export function nudgedCardId(
  response: Notifications.NotificationResponse,
): string | undefined {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
    return undefined;
  }
  const { cardId } = response.notification.request.content.data ?? {};
  return typeof cardId === "string" ? cardId : undefined;
}
