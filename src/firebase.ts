import { Capacitor, registerPlugin } from "@capacitor/core";

declare global {
  interface Window {
    __CRASH_TEST__?: boolean;
  }
}

type FirebaseAppPlugin = {
  getName?: () => Promise<{ name: string }>;
};

type FirebaseAnalyticsPlugin = {
  logEvent?: (opts: { name: string; params?: Record<string, unknown> }) => Promise<void>;
};

type FirebaseCrashlyticsPlugin = {
  setEnabled?: (opts: { enabled: boolean }) => Promise<void>;
  setCrashlyticsCollectionEnabled?: (opts: { enabled: boolean }) => Promise<void>;
  crash?: () => Promise<void>;
  testCrash?: () => Promise<void>;
};

const FirebaseApp = registerPlugin<FirebaseAppPlugin>("FirebaseApp");
const FirebaseAnalytics = registerPlugin<FirebaseAnalyticsPlugin>("FirebaseAnalytics");
const FirebaseCrashlytics = registerPlugin<FirebaseCrashlyticsPlugin>("FirebaseCrashlytics");
let didInitFirebase = false;

const isNativePlatform = (): boolean => {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android";
};

export async function initFirebase(): Promise<void> {
  if (didInitFirebase) return;
  didInitFirebase = true;

  if (!isNativePlatform()) {
    console.log("[Firebase] skip init on web platform");
    return;
  }

  const hasApp = Capacitor.isPluginAvailable("FirebaseApp");
  const hasAnalytics = Capacitor.isPluginAvailable("FirebaseAnalytics");
  const hasCrashlytics = Capacitor.isPluginAvailable("FirebaseCrashlytics");
  console.log("[Firebase] plugin availability", {
    app: hasApp,
    analytics: hasAnalytics,
    crashlytics: hasCrashlytics,
  });

  try {
    if (hasApp && FirebaseApp?.getName) {
      const app = await FirebaseApp.getName();
      console.log("[Firebase] app initialized", app?.name ?? "");
    }
  } catch (error) {
    console.log("[Firebase] app init error", error);
  }

  try {
    if (hasAnalytics && FirebaseAnalytics?.logEvent) {
      await FirebaseAnalytics.logEvent({ name: "app_open_chkoba" });
      console.log("[Firebase] analytics app_open_chkoba logged");
    } else {
      console.log("[Firebase] analytics plugin unavailable on native runtime");
    }
  } catch (error) {
    console.log("[Firebase] analytics error", error);
  }

  try {
    if (hasCrashlytics && FirebaseCrashlytics?.setEnabled) {
      await FirebaseCrashlytics.setEnabled({ enabled: true });
      console.log("[Firebase] crashlytics enabled via setEnabled");
    } else if (hasCrashlytics && FirebaseCrashlytics?.setCrashlyticsCollectionEnabled) {
      await FirebaseCrashlytics.setCrashlyticsCollectionEnabled({ enabled: true });
      console.log("[Firebase] crashlytics enabled via setCrashlyticsCollectionEnabled");
    }
  } catch (error) {
    console.log("[Firebase] crashlytics init error", error);
  }
}

export async function crashTest(): Promise<void> {
  if (!window.__CRASH_TEST__) return;
  if (!isNativePlatform()) {
    console.log("[Firebase] crash test skipped on web");
    return;
  }

  try {
    if (FirebaseCrashlytics?.crash) {
      await FirebaseCrashlytics.crash();
      return;
    }
    if (FirebaseCrashlytics?.testCrash) {
      await FirebaseCrashlytics.testCrash();
      return;
    }
    console.log("[Firebase] crash test method not available");
  } catch (error) {
    console.log("[Firebase] crashTest error", error);
  }
}
