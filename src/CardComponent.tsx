import React, { useMemo, useState } from "react";
import { Card } from "./types";
import { cn } from "./utils/cn";
import { backSrc, cardSrc, CardId } from "./game/cards";

function toSuitCode(suit: Card["suit"]): "D" | "H" | "S" | "C" {
  if (suit === "carreau") return "D";
  if (suit === "coeur") return "H";
  if (suit === "pique") return "S";
  return "C";
}

function toRankCode(rank: number): "01" | "02" | "03" | "04" | "05" | "06" | "07" | "V" | "Q" | "K" {
  if (rank >= 1 && rank <= 7) return `0${rank}` as "01" | "02" | "03" | "04" | "05" | "06" | "07";
  if (rank === 8) return "Q";
  if (rank === 9) return "V";
  return "K";
}

function cardAssetCandidates(card: Card): string[] {
  const suit = toSuitCode(card.suit);
  const rank = toRankCode(card.rank);
  const code = `${rank}${suit}` as CardId;
  return [cardSrc(code)];
}

function MissingCard({ width, height, label }: { width: number; height: number; label: string }) {
  return (
    <div
      role="img"
      aria-label={`missing-${label}`}
      style={{
        width,
        height,
        borderRadius: 8,
        border: "2px dashed #ef4444",
        background: "#111827",
        color: "#fecaca",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.2,
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      Missing
      <br />
      {label}
    </div>
  );
}

interface CardComponentProps {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  highlighted?: boolean;
  faceDown?: boolean;
  small?: boolean;
  disabled?: boolean;
}

export const CardComponent: React.FC<CardComponentProps> = ({
  card,
  onClick,
  selected = false,
  highlighted = false,
  faceDown = false,
  small = false,
  disabled = false,
}) => {
  const w = small ? 48 : 72;
  const h = small ? 68 : 100;

  const candidates = useMemo(() => cardAssetCandidates(card), [card.id, card.rank, card.suit]);
  const backCandidates = useMemo(() => [backSrc], []);
  const [index, setIndex] = useState(0);
  const [backIndex, setBackIndex] = useState(0);
  const [broken, setBroken] = useState(false);

  if (faceDown) {
    return (
      <div className={cn("playing-card playing-card--back rounded-lg shadow-lg overflow-hidden flex-shrink-0 select-none", small && "playing-card--small")} style={{ width: w, height: h }}>
        {!broken ? (
          <img
            src={backCandidates[Math.min(backIndex, backCandidates.length - 1)]}
            alt="card-back"
            draggable={false}
            onError={() => {
              const currentBack = backCandidates[Math.min(backIndex, backCandidates.length - 1)];
              console.error(`[CardBack] Missing asset: ${currentBack}`);
              if (backIndex < backCandidates.length - 1) {
                setBackIndex((prev) => prev + 1);
                return;
              }
              setBroken(true);
            }}
            style={{ width: "100%", height: "100%", objectFit: "cover", userSelect: "none", WebkitUserSelect: "none" }}
          />
        ) : (
          <MissingCard width={w} height={h} label="back.svg" />
        )}
      </div>
    );
  }

  const currentSrc = candidates[Math.min(index, candidates.length - 1)];
  const code = `${toRankCode(card.rank)}${toSuitCode(card.suit)}`;

  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={cn(
        "playing-card playing-card--face rounded-lg shadow-lg overflow-hidden flex-shrink-0 transition-all duration-200 select-none",
        small && "playing-card--small",
        !disabled && "cursor-pointer",
        selected && "ring-3 ring-yellow-400 -translate-y-3 scale-110 shadow-yellow-300/50 shadow-xl z-10",
        highlighted && "ring-3 ring-emerald-400 scale-105 shadow-emerald-300/50 shadow-xl z-10",
        !selected && !highlighted && !disabled && "hover:scale-105 hover:-translate-y-1 hover:shadow-xl",
        disabled && "opacity-60 cursor-not-allowed"
      )}
      style={{ width: w, height: h }}
    >
      {!broken ? (
        <img
          src={currentSrc}
          alt={code}
          draggable={false}
          onError={() => {
            console.error(`[Card] Missing asset: ${currentSrc} for ${code}`);
            if (index < candidates.length - 1) {
              setIndex((prev) => prev + 1);
              return;
            }
            setBroken(true);
          }}
          style={{ width: "100%", height: "100%", objectFit: "cover", userSelect: "none", WebkitUserSelect: "none" }}
        />
      ) : (
        <MissingCard width={w} height={h} label={`${code}.svg`} />
      )}
    </div>
  );
};

export const CardBack: React.FC<{ small?: boolean }> = ({ small = false }) => {
  const w = small ? 48 : 72;
  const h = small ? 68 : 100;
  const backCandidates = useMemo(() => [backSrc], []);
  const [backIndex, setBackIndex] = useState(0);
  const [broken, setBroken] = useState(false);

  return (
    <div className={cn("playing-card playing-card--back rounded-lg shadow-lg overflow-hidden flex-shrink-0 select-none", small && "playing-card--small")} style={{ width: w, height: h }}>
      {!broken ? (
        <img
          src={backCandidates[Math.min(backIndex, backCandidates.length - 1)]}
          alt="card-back"
          draggable={false}
          onError={() => {
            const currentBack = backCandidates[Math.min(backIndex, backCandidates.length - 1)];
            console.error(`[CardBack] Missing asset: ${currentBack}`);
            if (backIndex < backCandidates.length - 1) {
              setBackIndex((prev) => prev + 1);
              return;
            }
            setBroken(true);
          }}
          style={{ width: "100%", height: "100%", objectFit: "cover", userSelect: "none", WebkitUserSelect: "none" }}
        />
      ) : (
        <MissingCard width={w} height={h} label="back.svg" />
      )}
    </div>
  );
};
