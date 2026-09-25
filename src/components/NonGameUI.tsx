import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";
import UiIcon from "./UiIcon";

type NonGameScreenProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function NonGameScreen({ children, className, contentClassName }: NonGameScreenProps) {
  return (
    <div className={cn("premium-screen premium-scroll safe-area non-game-screen min-h-screen text-white", className)}>
      <div className="non-game-mosaic" aria-hidden="true" />
      <div className="non-game-arch" aria-hidden="true" />
      <main className={cn("non-game-content mx-auto w-full max-w-md", contentClassName)}>{children}</main>
    </div>
  );
}

type NonGameHeroProps = {
  title: string;
  subtitle: string;
  icon?: ReactNode;
  eyebrow?: string;
  compact?: boolean;
};

export function NonGameHero({ title, subtitle, icon, eyebrow, compact = false }: NonGameHeroProps) {
  return (
    <header className={cn("non-game-hero", compact && "non-game-hero--compact")}>
      {icon && <div className="non-game-hero__icon" aria-hidden="true">{icon}</div>}
      {eyebrow && <p className="non-game-kicker">{eyebrow}</p>}
      <h1 className="non-game-title">{title}</h1>
      <p className="non-game-subtitle">{subtitle}</p>
    </header>
  );
}

type ActionTone = "online" | "classic" | "team" | "local" | "neutral";

type MenuActionCardProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  title: string;
  subtitle: string;
  icon: ReactNode;
  tone: ActionTone;
  badge?: string;
};

export function MenuActionCard({
  title,
  subtitle,
  icon,
  tone,
  badge,
  className,
  disabled,
  ...buttonProps
}: MenuActionCardProps) {
  return (
    <button
      {...buttonProps}
      disabled={disabled}
      className={cn("menu-action-card", `menu-action-card--${tone}`, disabled && "menu-action-card--disabled", className)}
    >
      <span className="menu-action-card__ornament" aria-hidden="true" />
      <span className="menu-action-card__icon" aria-hidden="true">{icon}</span>
      <span className="menu-action-card__copy">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      {badge && <span className="menu-action-card__badge">{badge}</span>}
      {!disabled && <span className="menu-action-card__arrow" aria-hidden="true"><UiIcon name="chevron" size={23} /></span>}
    </button>
  );
}

type ScoreChoiceModalProps = {
  open: boolean;
  description: string;
  onClose: () => void;
  onSelect: (score: 11 | 21) => void;
};

export function ScoreChoiceModal({ open, description, onClose, onSelect }: ScoreChoiceModalProps) {
  if (!open) return null;

  return (
    <div className="non-game-modal-backdrop" role="presentation">
      <section className="non-game-modal score-choice-modal" role="dialog" aria-modal="true" aria-labelledby="score-choice-title">
        <button onClick={onClose} className="non-game-modal__close" aria-label="Fermer">✕</button>
        <p className="non-game-kicker">Format de la partie</p>
        <h3 id="score-choice-title" className="non-game-modal__title">Choisissez le score</h3>
        <p className="non-game-modal__message">{description}</p>
        <div className="score-choice-grid">
          <button onClick={() => onSelect(11)} className="score-choice score-choice--quick">
            <span>Partie rapide</span>
            <strong>11</strong>
            <small>points</small>
          </button>
          <button onClick={() => onSelect(21)} className="score-choice score-choice--long">
            <span>Partie longue</span>
            <strong>21</strong>
            <small>points</small>
          </button>
        </div>
      </section>
    </div>
  );
}

export function BackButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <div className="non-game-sticky-header">
      <button {...props} className={cn("non-game-back", className)}>
        <UiIcon name="back" size={18} />
        Retour
      </button>
    </div>
  );
}
