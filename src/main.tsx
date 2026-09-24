import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { crashTest, initFirebase } from "./firebase";
import { initializeAdMob, preloadRewardedMatchEntryAd } from "./services/admobService";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Let the native view finish presenting before UMP potentially opens its form.
window.setTimeout(() => {
  void (async () => {
    await initFirebase();
    if (await initializeAdMob()) {
      void preloadRewardedMatchEntryAd();
    }
    await crashTest();
  })();
}, 500);
