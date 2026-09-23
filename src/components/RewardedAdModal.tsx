type RewardedAdModalProps = {
  open: boolean;
  status: "loading" | "success";
};

export default function RewardedAdModal({ open, status }: RewardedAdModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="premium-panel rounded-2xl max-w-sm w-full p-6 text-center">
        {status === "loading" ? (
          <>
            <div className="text-4xl animate-pulse mb-3">🎬</div>
            <h3 className="premium-title text-2xl font-black text-amber-200 mb-2">Publicité en cours...</h3>
            <p className="text-green-200/90 text-sm">Veuillez patienter quelques secondes.</p>
            <div className="mt-4 h-1.5 w-full bg-black/30 rounded-full overflow-hidden">
              <div className="h-full w-1/3 bg-gradient-to-r from-emerald-400 to-teal-300 animate-[pulse_1s_ease-in-out_infinite]" />
            </div>
          </>
        ) : (
          <>
            <div className="text-4xl mb-3">✅</div>
            <h3 className="premium-title text-2xl font-black text-emerald-200 mb-2">Récompense validée</h3>
            <p className="text-green-200/90 text-sm">+1 partie ajoutée.</p>
          </>
        )}
      </div>
    </div>
  );
}
