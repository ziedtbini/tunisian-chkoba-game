type NotEnoughCoinsModalProps = {
  open: boolean;
  onEarnCoins: () => void;
  onCancel: () => void;
  title?: string;
  message?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
};

export default function NotEnoughCoinsModal({
  open,
  onEarnCoins,
  onCancel,
  title = "Pas assez de coins",
  message = "Vous avez besoin de plus de coins pour jouer en ligne.",
  primaryLabel = "Gagner des coins",
  secondaryLabel = "Annuler",
}: NotEnoughCoinsModalProps) {
  if (!open) return null;

  return (
    <div className="non-game-modal-backdrop z-[90]">
      <section className="non-game-modal w-full max-w-md" role="dialog" aria-modal="true" aria-labelledby="match-entry-modal-title">
        <p className="non-game-kicker">Accès en ligne</p>
        <h3 id="match-entry-modal-title" className="non-game-modal__title">{title}</h3>
        <p className="non-game-modal__message">{message}</p>
        <div className="non-game-modal__actions">
          <button
            onClick={onCancel}
            className="non-game-secondary-button"
          >
            {secondaryLabel}
          </button>
          <button
            onClick={onEarnCoins}
            className="non-game-primary-button"
          >
            {primaryLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
