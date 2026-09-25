type QuitConfirmModalProps = {
  open: boolean;
  online: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function QuitConfirmModal({
  open,
  online: _online,
  onCancel,
  onConfirm,
}: QuitConfirmModalProps) {
  if (!open) return null;

  return (
    <div className="non-game-modal-backdrop z-[90]">
      <section className="non-game-modal w-full max-w-md" role="dialog" aria-modal="true" aria-labelledby="quit-modal-title">
        <p className="non-game-kicker">Partie en cours</p>
        <h3 id="quit-modal-title" className="non-game-modal__title">Quitter la partie ?</h3>
        <p className="non-game-modal__message">Voulez-vous vraiment quitter la partie ?</p>
        <p className="non-game-modal__warning">Cette sortie comptera comme une défaite.</p>
        <div className="non-game-modal__actions">
          <button
            onClick={onCancel}
            className="non-game-secondary-button"
          >
            Continuer
          </button>
          <button
            onClick={onConfirm}
            className="non-game-danger-button"
          >
            Quitter
          </button>
        </div>
      </section>
    </div>
  );
}
