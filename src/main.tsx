import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { crashTest, initFirebase } from "./firebase";
import { initializeAdMob, preloadRewardedMatchEntryAd } from "./services/admobService";

void (async () => {
  await initFirebase();
  if (await initializeAdMob()) {
    void preloadRewardedMatchEntryAd();
  }
  await crashTest();
})();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
