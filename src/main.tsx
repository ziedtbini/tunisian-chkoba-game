import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { crashTest, initFirebase } from "./firebase";
import { initializeAdMob } from "./services/admobService";

void (async () => {
  await initFirebase();
  await initializeAdMob();
  await crashTest();
})();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
