import { useEffect } from "react";
import Card from "./components/Card";
import { preloadAllCards } from "./game/preloadCards";

export default function CardsDemo() {
  useEffect(() => {
    preloadAllCards();
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #14532d, #052e16)",
        color: "white",
        padding: 24,
        boxSizing: "border-box",
        userSelect: "none",
      }}
    >
      <h1 style={{ marginTop: 0 }}>Cards Demo</h1>
      <p style={{ opacity: 0.85 }}>Route: /cards-demo</p>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 12 }}>Main (3 cartes)</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Card cardId="01D" />
          <Card cardId="QH" rotate={-3} />
          <Card cardId="KD" rotate={3} />
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 12 }}>Table (4 cartes)</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Card cardId="02D" width={95} />
          <Card cardId="03C" width={95} />
          <Card cardId="07S" width={95} />
          <Card cardId="VH" width={95} />
        </div>
      </section>

      <section>
        <h2 style={{ marginBottom: 12 }}>Carte retournee</h2>
        <Card cardId="01D" faceUp={false} />
      </section>
    </div>
  );
}
