export type AchievementId =
  | "first_game"
  | "first_online"
  | "first_chkoba"
  | "first_win"
  | "first_2v2";

export type AchievementMeta = {
  id: AchievementId;
  title: string;
  description: string;
};

const STORAGE_KEY = "chkoba-achievements-v1";

export const ACHIEVEMENTS: AchievementMeta[] = [
  { id: "first_game", title: "Premiere Main", description: "Lancer une partie locale." },
  { id: "first_online", title: "Connecte", description: "Ouvrir le mode en ligne." },
  { id: "first_chkoba", title: "Chkoba!", description: "Reussir une chkoba." },
  { id: "first_win", title: "Champion", description: "Gagner une partie." },
  { id: "first_2v2", title: "Equipe", description: "Lancer un match 2v2." },
];

function readMap(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function getUnlockedAchievements(): AchievementId[] {
  const map = readMap();
  return ACHIEVEMENTS.map((a) => a.id).filter((id) => map[id]);
}

export function unlockAchievement(id: AchievementId): boolean {
  const map = readMap();
  if (map[id]) return false;
  map[id] = true;
  writeMap(map);
  return true;
}

export function getAchievementMeta(id: AchievementId): AchievementMeta {
  return ACHIEVEMENTS.find((a) => a.id === id) ?? ACHIEVEMENTS[0];
}
