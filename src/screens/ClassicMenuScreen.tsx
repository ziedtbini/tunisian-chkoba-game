import React from "react";
import { cn } from "../utils/cn";

type ScoreTarget = 11 | 21;

type ClassicMenuScreenProps = {
  onBack: () => void;
  onPlaySolo: (targetScore: ScoreTarget) => void;
  onPlayLocal: (targetScore: ScoreTarget) => void;
};

type ClassicActionCardProps = {
  title: string;
  subtitle: string;
  onClick: () => void;
  tone: "amber" | "blue";
};

const toneClass: Record<ClassicActionCardProps["tone"], string> = {
  amber:
    "bg-gradient-to-r from-amber-500/95 to-yellow-600/95 border-amber-200/20 text-amber-950",
  blue:
    "bg-gradient-to-r from-blue-500/95 to-indigo-600/95 border-blue-200/20 text-white",
};

const ClassicActionCard: React.FC<ClassicActionCardProps> = ({
  title,
  subtitle,
  onClick,
  tone,
}) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full rounded-2xl p-5 text-left border shadow-[0_16px_30px_rgba(0,0,0,0.28)] transition-all hover:scale-[1.01] active:scale-[0.99]",
      toneClass[tone]
    )}
  >
    <div className="text-2xl font-black mb-1">{title}</div>
    <div className={cn("text-sm opacity-90", tone === "amber" ? "text-amber-900/85" : "text-blue-100/90")}>
      {subtitle}
    </div>
  </button>
);

const ClassicMenuScreen: React.FC<ClassicMenuScreenProps> = ({ onBack, onPlaySolo, onPlayLocal }) => {
  const [scorePickerFor, setScorePickerFor] = React.useState<"solo" | "local" | null>(null);

  const chooseScore = (targetScore: ScoreTarget) => {
    if (scorePickerFor === "solo") onPlaySolo(targetScore);
    if (scorePickerFor === "local") onPlayLocal(targetScore);
    setScorePickerFor(null);
  };

  return (
    <div className="premium-screen premium-scroll safe-area min-h-screen text-white px-5 py-6">
      <div className="mx-auto max-w-md w-full">
        <button
          onClick={onBack}
          className="mb-5 premium-chip rounded-xl px-3 py-2 text-sm text-green-100 hover:text-white transition-colors"
        >
          ← Retour
        </button>

        <h1 className="premium-title text-4xl font-black bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 bg-clip-text text-transparent mb-1">
          Jouer classique
        </h1>
        <p className="text-green-300 mb-6">Modes solo et local sur le meme appareil.</p>

        <div className="space-y-4">
          <ClassicActionCard
            title="Contre l'ordinateur"
            subtitle="1 joueur vs CPU"
            onClick={() => setScorePickerFor("solo")}
            tone="amber"
          />

          <ClassicActionCard
            title="2 joueurs local"
            subtitle="Sur le meme appareil"
            onClick={() => setScorePickerFor("local")}
            tone="blue"
          />
        </div>
      </div>

      {scorePickerFor && (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="premium-panel rounded-2xl max-w-sm w-full p-5 relative">
            <button
              onClick={() => setScorePickerFor(null)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full premium-chip text-green-200 hover:text-white"
              aria-label="Fermer"
            >
              ✕
            </button>
            <h3 className="premium-title text-2xl font-black text-amber-200 mb-2">Choisir Le Score</h3>
            <p className="text-green-200/90 text-sm mb-4">Lancer la partie jusqu a:</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => chooseScore(11)}
                className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-3 rounded-xl premium-glow"
              >
                11 points
              </button>
              <button
                onClick={() => chooseScore(21)}
                className="bg-gradient-to-r from-amber-500 to-yellow-500 text-amber-950 font-bold py-3 rounded-xl premium-glow"
              >
                21 points
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassicMenuScreen;
