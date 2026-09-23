import React from "react";
import { cn } from "../utils/cn";

type OnlineMenuScreenProps = {
  onBack: () => void;
  onPlay1v1: () => void;
  onPlay2v2: () => void;
};

type OnlineActionCardProps = {
  title: string;
  subtitle: string;
  onClick?: () => void;
  disabled?: boolean;
  soon?: boolean;
  tone: "emerald" | "fuchsia" | "neutral";
};

const toneClass: Record<OnlineActionCardProps["tone"], string> = {
  emerald:
    "bg-gradient-to-r from-emerald-500/95 to-teal-600/95 border-emerald-200/20 text-white",
  fuchsia:
    "bg-gradient-to-r from-fuchsia-500/95 to-pink-600/95 border-fuchsia-200/20 text-white",
  neutral:
    "bg-gradient-to-r from-slate-700/65 to-slate-800/70 border-slate-300/15 text-slate-100",
};

const OnlineActionCard: React.FC<OnlineActionCardProps> = ({
  title,
  subtitle,
  onClick,
  disabled = false,
  soon = false,
  tone,
}) => (
  <button
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    className={cn(
      "w-full rounded-2xl p-5 text-left border shadow-[0_16px_30px_rgba(0,0,0,0.28)] transition-all relative",
      !disabled && "hover:scale-[1.01] active:scale-[0.99]",
      disabled && "opacity-65 cursor-not-allowed saturate-75",
      toneClass[tone]
    )}
  >
    {soon && (
      <span className="absolute top-3 right-3 text-[10px] uppercase tracking-wide bg-amber-400/20 text-amber-200 border border-amber-300/40 rounded-full px-2 py-1 font-bold">
        Bientot
      </span>
    )}
    <div className="text-2xl font-black mb-1">{title}</div>
    <div className="text-sm opacity-90">{subtitle}</div>
  </button>
);

const OnlineMenuScreen: React.FC<OnlineMenuScreenProps> = ({ onBack, onPlay1v1, onPlay2v2 }) => {
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
          Jouer en ligne
        </h1>
        <p className="text-green-300 mb-6">Jouez a distance avec vos amis, en duel ou en equipe.</p>

        <div className="space-y-4">
          <OnlineActionCard
            title="1v1 avec un ami"
            subtitle="Affrontez un ami a distance"
            onClick={onPlay1v1}
            tone="emerald"
          />

          <OnlineActionCard
            title="2v2 avec des amis"
            subtitle="Jouez en equipe a distance"
            onClick={onPlay2v2}
            tone="fuchsia"
          />

          <OnlineActionCard
            title="Trouver un adversaire"
            subtitle="Bientot disponible"
            disabled
            soon
            tone="neutral"
          />
        </div>
      </div>
    </div>
  );
};

export default OnlineMenuScreen;
