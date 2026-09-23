const MATCH_ENTRIES_STORAGE_KEY = "chkoba-available-matches-v1";

export const DEFAULT_MATCH_ENTRIES = 3;

export function loadMatchEntries(defaultValue: number = DEFAULT_MATCH_ENTRIES): number {
  try {
    const raw = localStorage.getItem(MATCH_ENTRIES_STORAGE_KEY);
    if (!raw) return defaultValue;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return defaultValue;
    return parsed;
  } catch {
    return defaultValue;
  }
}

export function saveMatchEntries(value: number): void {
  try {
    const safe = Math.max(0, Math.floor(value));
    localStorage.setItem(MATCH_ENTRIES_STORAGE_KEY, String(safe));
  } catch {
    // Ignore storage errors (private mode / quota / platform differences)
  }
}
