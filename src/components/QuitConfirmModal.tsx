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
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="premium-panel rounded-2xl w-full max-w-md p-6">
        <h3 className="premium-title text-2xl font-black text-amber-200 mb-2">Quitter La Partie ?</h3>
        <p className="text-green-100/90 text-sm mb-4">Voulez-vous vraiment quitter la partie ?</p>
        <p className="text-sm text-red-200 mb-5">Cette sortie comptera comme une défaite.</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            className="premium-chip rounded-xl py-3 text-green-200 font-semibold"
          >
            Continuer
          </button>
          <button
            onClick={onConfirm}
            className="bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-xl py-3 font-bold premium-glow"
          >
            Quitter
          </button>
        </div>
      </div>
    </div>
  );
}
