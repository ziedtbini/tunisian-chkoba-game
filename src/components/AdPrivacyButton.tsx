import { useEffect, useState } from "react";
import { isAdPrivacyOptionsRequired, showAdPrivacyOptions, subscribeToAdPrivacyStatus } from "../services/admobService";

export default function AdPrivacyButton() {
  const [visible, setVisible] = useState(isAdPrivacyOptionsRequired);
  useEffect(() => subscribeToAdPrivacyStatus(setVisible), []);
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => void showAdPrivacyOptions()}
      className="fixed bottom-3 right-3 z-[80] rounded-full border border-white/20 bg-black/70 px-3 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      Confidentialite
    </button>
  );
}
