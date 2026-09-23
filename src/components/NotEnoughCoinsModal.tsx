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
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="premium-panel rounded-2xl w-full max-w-md p-6">
        <h3 className="premium-title text-2xl font-black text-amber-200 mb-2">{title}</h3>
        <p className="text-green-100/90 text-sm mb-5">{message}</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            className="premium-chip rounded-xl py-3 text-green-200 font-semibold"
          >
            {secondaryLabel}
          </button>
          <button
            onClick={onEarnCoins}
            className="bg-gradient-to-r from-amber-500 to-yellow-500 text-amber-950 rounded-xl py-3 font-bold premium-glow"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
