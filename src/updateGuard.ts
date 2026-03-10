import { Capacitor, registerPlugin } from "@capacitor/core";

type AppInfo = {
  version?: string;
  build?: string;
};

type AppPlugin = {
  getInfo?: () => Promise<AppInfo>;
};

type RemoteConfigPlugin = {
  setSettings?: (options: { minimumFetchIntervalInSeconds: number; fetchTimeoutInSeconds?: number }) => Promise<void>;
  fetchAndActivate?: () => Promise<unknown>;
  getString?: (options: { key: string }) => Promise<{ value: string }>;
  getBoolean?: (options: { key: string }) => Promise<{ value: boolean }>;
};

export type UpdatePolicy = {
  minSupportedVersion?: string;
  latestVersion?: string;
  forceUpdate?: boolean;
  message?: string;
  title?: string;
  iosStoreUrl?: string;
  androidStoreUrl?: string;
};

export type UpdateDecision = {
  hasUpdate: boolean;
  required: boolean;
  currentVersion: string;
  targetVersion: string;
  title: string;
  message: string;
  storeUrl: string;
};

const App = registerPlugin<AppPlugin>("App");
const FirebaseRemoteConfig = registerPlugin<RemoteConfigPlugin>("FirebaseRemoteConfig");

const DEFAULT_TITLE = "Mise a jour disponible";
const DEFAULT_MESSAGE = "Une nouvelle version est disponible.";
const FALLBACK_VERSION = "0.0.0";

function normalizeVersion(input: string): number[] {
  const cleaned = input.trim().replace(/^v/i, "");
  return cleaned
    .split(".")
    .map((p) => Number.parseInt(p.replace(/[^\d].*$/, ""), 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

export function compareVersions(a: string, b: string): number {
  const av = normalizeVersion(a);
  const bv = normalizeVersion(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i += 1) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

async function getCurrentVersion(): Promise<string> {
  try {
    if (Capacitor.getPlatform() === "ios" || Capacitor.getPlatform() === "android") {
      const info = await App.getInfo?.();
      if (info?.version && info.version.trim()) {
        console.log("[UpdateGuard] native app version", info.version.trim());
        return info.version.trim();
      }
      console.log("[UpdateGuard] native app version unavailable", info);
    }
  } catch (error) {
    console.log("[UpdateGuard] getInfo error", error);
  }
  const fallback = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? FALLBACK_VERSION;
  console.log("[UpdateGuard] fallback version used", fallback);
  return fallback;
}

const RC_KEYS = {
  latestVersion: "update_latest_version",
  minSupportedVersion: "update_min_supported_version",
  forceUpdate: "update_force_update",
  title: "update_title",
  message: "update_message",
  iosStoreUrl: "update_ios_store_url",
  androidStoreUrl: "update_android_store_url",
};

async function getRemoteString(key: string): Promise<string> {
  try {
    const result = await FirebaseRemoteConfig.getString?.({ key });
    return result?.value?.trim() ?? "";
  } catch (error) {
    console.log("[UpdateGuard] getString error", key, error);
    return "";
  }
}

async function getRemoteBoolean(key: string): Promise<boolean> {
  try {
    const result = await FirebaseRemoteConfig.getBoolean?.({ key });
    if (typeof result?.value === "boolean") return result.value;
  } catch (error) {
    console.log("[UpdateGuard] getBoolean error", key, error);
  }
  const asString = (await getRemoteString(key)).toLowerCase();
  return asString === "true" || asString === "1" || asString === "yes";
}

async function fetchPolicy(): Promise<UpdatePolicy | null> {
  if (!Capacitor.isPluginAvailable("FirebaseRemoteConfig")) {
    console.log("[UpdateGuard] FirebaseRemoteConfig plugin indisponible");
    return null;
  }

  try {
    await FirebaseRemoteConfig.setSettings?.({
      minimumFetchIntervalInSeconds: 60,
      fetchTimeoutInSeconds: 8,
    });
    await FirebaseRemoteConfig.fetchAndActivate?.();

    const [
      latestVersion,
      minSupportedVersion,
      title,
      message,
      iosStoreUrl,
      androidStoreUrl,
      forceUpdate,
    ] = await Promise.all([
      getRemoteString(RC_KEYS.latestVersion),
      getRemoteString(RC_KEYS.minSupportedVersion),
      getRemoteString(RC_KEYS.title),
      getRemoteString(RC_KEYS.message),
      getRemoteString(RC_KEYS.iosStoreUrl),
      getRemoteString(RC_KEYS.androidStoreUrl),
      getRemoteBoolean(RC_KEYS.forceUpdate),
    ]);

    const hasAnyConfig =
      latestVersion ||
      minSupportedVersion ||
      iosStoreUrl ||
      androidStoreUrl;
    if (!hasAnyConfig) {
      console.log("[UpdateGuard] aucune config update remote");
      return null;
    }

    return {
      latestVersion: latestVersion || undefined,
      minSupportedVersion: minSupportedVersion || undefined,
      forceUpdate,
      title: title || undefined,
      message: message || undefined,
      iosStoreUrl: iosStoreUrl || undefined,
      androidStoreUrl: androidStoreUrl || undefined,
    };
  } catch (error) {
    console.log("[UpdateGuard] remote config fetch error", error);
    return null;
  }
}

function resolveStoreUrl(policy: UpdatePolicy): string {
  const platform = Capacitor.getPlatform();
  if (platform === "ios") return policy.iosStoreUrl ?? "";
  if (platform === "android") return policy.androidStoreUrl ?? "";
  return "";
}

export async function checkForUpdate(): Promise<UpdateDecision | null> {
  const platform = Capacitor.getPlatform();
  if (platform !== "ios" && platform !== "android") {
    console.log("[UpdateGuard] skipped (platform web)");
    return null;
  }

  console.log("[UpdateGuard] check start", { platform });
  const [currentVersion, policy] = await Promise.all([getCurrentVersion(), fetchPolicy()]);
  if (!policy) {
    console.log("[UpdateGuard] no policy / no update");
    return null;
  }

  const storeUrl = resolveStoreUrl(policy);
  if (!storeUrl) {
    console.log("[UpdateGuard] storeUrl manquante");
    return null;
  }

  const minSupported = policy.minSupportedVersion?.trim();
  const latest = policy.latestVersion?.trim();
  const force = !!policy.forceUpdate;

  const requiredByMin = !!minSupported && compareVersions(currentVersion, minSupported) < 0;
  const optionalByLatest = !!latest && compareVersions(currentVersion, latest) < 0;

  if (!requiredByMin && !optionalByLatest) {
    console.log("[UpdateGuard] up-to-date", { currentVersion, minSupported, latest });
    return null;
  }

  const required = requiredByMin && force;
  const targetVersion = requiredByMin ? (minSupported as string) : (latest as string);
  console.log("[UpdateGuard] update found", {
    currentVersion,
    targetVersion,
    required,
    requiredByMin,
    optionalByLatest,
  });

  return {
    hasUpdate: true,
    required,
    currentVersion,
    targetVersion,
    title: policy.title?.trim() || DEFAULT_TITLE,
    message: policy.message?.trim() || DEFAULT_MESSAGE,
    storeUrl,
  };
}

export function openStore(url: string): void {
  try {
    window.location.href = url;
  } catch (error) {
    console.log("[UpdateGuard] openStore error", error);
  }
}
