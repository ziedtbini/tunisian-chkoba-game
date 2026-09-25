import { Capacitor, registerPlugin } from "@capacitor/core";
import { FirebaseCrashlytics } from "@capacitor-firebase/crashlytics";

type AnalyticsPlugin = { logEvent?: (options: { name: string; params?: Record<string, string | number> }) => Promise<void> };
const Analytics = registerPlugin<AnalyticsPlugin>("FirebaseAnalytics");

const ALLOWED_PARAM_KEYS = new Set([
  "mode",
  "role",
  "reasonCode",
  "reconnectAttempt",
  "platform",
  "protocolVersion",
  "connectionStage",
  "appVersion",
]);

export type OnlineTelemetryParams = Partial<Record<
  "mode" | "role" | "reasonCode" | "reconnectAttempt" | "platform" | "protocolVersion" | "connectionStage" | "appVersion",
  string | number
>>;

export type OnlineEvent =
  | "online_room_created" | "online_join_started" | "online_join_success" | "online_join_failed"
  | "online_match_started" | "online_disconnect" | "online_reconnect_started"
  | "online_reconnect_success" | "online_reconnect_failed" | "online_sync_requested"
  | "online_action_rejected" | "online_match_completed";

function sanitizeParams(params: OnlineTelemetryParams): Record<string, string | number> {
  const safe: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (ALLOWED_PARAM_KEYS.has(key) && (typeof value === "string" || typeof value === "number")) safe[key] = value;
  }
  safe.platform = Capacitor.getPlatform();
  return safe;
}

export async function logOnlineEvent(name: OnlineEvent, params: OnlineTelemetryParams = {}): Promise<void> {
  try {
    const safeParams = sanitizeParams(params);
    if (Capacitor.isPluginAvailable("FirebaseAnalytics") && Analytics.logEvent) {
      await Analytics.logEvent({ name, params: safeParams });
    } else if (import.meta.env.DEV) {
      console.debug(`[Online] ${name}`, safeParams);
    }
  } catch {
    // Telemetry must never affect the match.
  }
}

export async function recordOnlineNetworkError(
  reasonCode: string,
  params: Omit<OnlineTelemetryParams, "reasonCode"> = {},
): Promise<void> {
  try {
    if (!Capacitor.isPluginAvailable("FirebaseCrashlytics")) return;
    const safeParams = sanitizeParams({ ...params, reasonCode });
    for (const [key, value] of Object.entries(safeParams)) {
      await FirebaseCrashlytics.setCustomKey({
        key: `online_${key}`,
        value,
        type: typeof value === "number" ? "double" : "string",
      });
    }
    await FirebaseCrashlytics.recordException({ message: `Online network error: ${reasonCode}` });
  } catch {
    // Crash reporting must never affect the match.
  }
}
