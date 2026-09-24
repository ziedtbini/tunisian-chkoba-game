import { Capacitor, registerPlugin } from "@capacitor/core";

type AnalyticsPlugin = { logEvent?: (options: { name: string; params?: Record<string, string | number> }) => Promise<void> };
const Analytics = registerPlugin<AnalyticsPlugin>("FirebaseAnalytics");

export type OnlineEvent =
  | "online_room_created" | "online_join_started" | "online_join_success" | "online_join_failed"
  | "online_match_started" | "online_disconnect" | "online_reconnect_started"
  | "online_reconnect_success" | "online_reconnect_failed" | "online_sync_requested"
  | "online_action_rejected" | "online_match_completed";

export async function logOnlineEvent(name: OnlineEvent, params: Record<string, string | number> = {}): Promise<void> {
  const safeParams = { ...params, platform: Capacitor.getPlatform() };
  try {
    if (Capacitor.isPluginAvailable("FirebaseAnalytics") && Analytics.logEvent) {
      await Analytics.logEvent({ name, params: safeParams });
    } else if (import.meta.env.DEV) {
      console.debug(`[Online] ${name}`, safeParams);
    }
  } catch {
    // Telemetry must never affect the match.
  }
}
