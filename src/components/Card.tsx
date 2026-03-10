import { useMemo, useState } from "react";
import { backSrc, cardSrc, CardId } from "../game/cards";

type CardProps = {
  cardId: CardId;
  faceUp?: boolean;
  width?: number;
  rotate?: number;
  onClick?: () => void;
};

export default function Card({
  cardId,
  faceUp = true,
  width = 110,
  rotate = 0,
  onClick,
}: CardProps) {
  const [hasError, setHasError] = useState(false);
  const src = useMemo(() => (faceUp ? cardSrc(cardId) : backSrc), [cardId, faceUp]);
  const height = Math.round(width * 1.45);
  const clickable = typeof onClick === "function";

  if (hasError) {
    return (
      <div
        role="img"
        aria-label={`missing-card-${faceUp ? cardId : "back"}`}
        onClick={onClick}
        style={{
          width,
          height,
          transform: `rotate(${rotate}deg)`,
          borderRadius: 10,
          border: "2px dashed #ef4444",
          background: "#111827",
          color: "#fecaca",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          fontSize: 12,
          fontWeight: 700,
          userSelect: "none",
          cursor: clickable ? "pointer" : "default",
        }}
      >
        Missing
        <br />
        {faceUp ? cardId : "back"}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={faceUp ? cardId : "card-back"}
      draggable={false}
      onClick={onClick}
      onError={() => {
        console.error(`[Card] Missing asset: ${src}`);
        setHasError(true);
      }}
      style={{
        width,
        height: "auto",
        transform: `rotate(${rotate}deg)`,
        display: "block",
        userSelect: "none",
        WebkitUserSelect: "none",
        cursor: clickable ? "pointer" : "default",
      }}
    />
  );
}
