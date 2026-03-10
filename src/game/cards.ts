export type Suit = "D" | "H" | "S" | "C";
export type Rank =
  | "01"
  | "02"
  | "03"
  | "04"
  | "05"
  | "06"
  | "07"
  | "V"
  | "Q"
  | "K";

export type CardId = `${Rank}${Suit}`;

const SUITS: Suit[] = ["D", "H", "S", "C"];
const RANKS: Rank[] = ["01", "02", "03", "04", "05", "06", "07", "Q", "V", "K"];

const cardAssets = import.meta.glob("../assets/cards-png/*.png", {
  eager: true,
  import: "default",
}) as Record<string, string>;

function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1];
}

const assetsByFileName = new Map<string, string>(
  Object.entries(cardAssets).map(([path, resolvedUrl]) => [fileName(path), resolvedUrl])
);

function assetUrl(name: string): string {
  const url = assetsByFileName.get(name);
  if (url) return url;
  console.error(`[cards] Missing local PNG asset in src/assets/cards-png: ${name}`);
  return "";
}

export function cardSrc(id: CardId): string {
  // Compatibility alias for provided assets: valet de carreau is stored as JD.png.
  if (id === "VD") return assetUrl("JD.png");
  return assetUrl(`${id}.png`);
}

export const backSrc = assetUrl("back.png");

export const ALL_CARDS: CardId[] = SUITS.flatMap((suit) =>
  RANKS.map((rank) => `${rank}${suit}` as CardId)
);
