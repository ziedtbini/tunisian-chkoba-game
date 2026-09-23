import { useEffect, useState } from 'react';
import ChkobaGame from './ChkobaGame';
import CardsDemo from './CardsDemo';
import { checkForUpdate, openStore, UpdateDecision } from './updateGuard';
import AdPrivacyButton from './components/AdPrivacyButton';

function App() {
  const [showBootSplash, setShowBootSplash] = useState(true);
  const [updateDecision, setUpdateDecision] = useState<UpdateDecision | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(true);
  const [dismissedOptionalUpdate, setDismissedOptionalUpdate] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setShowBootSplash(false), 900);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const decision = await checkForUpdate();
        console.log("[UpdateGuard] startup decision", decision);
        if (active) setUpdateDecision(decision);
      } catch (error) {
        console.log('[UpdateGuard] startup check error', error);
      } finally {
        if (active) setCheckingUpdate(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (window.location.pathname === "/cards-demo") {
    return <CardsDemo />;
  }

  if (showBootSplash) {
    return (
      <div className="boot-splash">
        <div className="boot-splash-inner">
          <img src="/apple-touch-icon.png" alt="Chkoba logo" className="boot-splash-logo" />
          <div className="boot-splash-suits">♠ ♥ ♦ ♣</div>
        </div>
      </div>
    );
  }

  if (!checkingUpdate && updateDecision?.required) {
    return (
      <div
        className="fixed inset-0 z-[95] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4"
        style={{
          paddingTop: "max(16px, env(safe-area-inset-top))",
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
        }}
      >
        <UpdateModal
          decision={updateDecision}
          onUpdateNow={() => openStore(updateDecision.storeUrl)}
        />
      </div>
    );
  }

  return (
    <>
      <ChkobaGame />
      <AdPrivacyButton />
      {!checkingUpdate && updateDecision && !updateDecision.required && !dismissedOptionalUpdate && (
        <div
          className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4"
          style={{
            paddingTop: "max(16px, env(safe-area-inset-top))",
            paddingBottom: "max(16px, env(safe-area-inset-bottom))",
          }}
        >
          <UpdateModal
            decision={updateDecision}
            onUpdateNow={() => openStore(updateDecision.storeUrl)}
            onLater={() => setDismissedOptionalUpdate(true)}
          />
        </div>
      )}
    </>
  );
}

function UpdateModal({
  decision,
  onUpdateNow,
  onLater,
}: {
  decision: UpdateDecision;
  onUpdateNow: () => void;
  onLater?: () => void;
}) {
  const displayCurrentVersion = decision.currentVersion === "0.0.0" ? "inconnue" : decision.currentVersion;
  return (
    <div className="w-full max-w-sm max-h-full overflow-y-auto">
      <div className="premium-panel rounded-2xl p-6 text-white border border-amber-300/30">
        <h2 className="premium-title text-2xl font-black text-amber-200 mb-3">{decision.title}</h2>
        <p className="text-green-100/90 mb-2">{decision.message}</p>
        <p className="text-xs text-green-300/80 mb-6">
          Version actuelle: {displayCurrentVersion} | Version cible: {decision.targetVersion}
        </p>
        <div className="flex gap-3">
          {onLater && (
            <button
              onClick={onLater}
              className="flex-1 bg-black/25 border border-green-200/30 rounded-xl py-3 font-bold text-green-100"
            >
              Plus tard
            </button>
          )}
          <button
            onClick={onUpdateNow}
            className="flex-1 bg-gradient-to-r from-amber-500 to-yellow-500 text-amber-950 rounded-xl py-3 font-black premium-glow"
          >
            Mettre a jour
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
