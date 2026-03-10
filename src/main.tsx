import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { crashTest, enablePush, initFirebase } from "./firebase";

void (async () => {
  await initFirebase();
  await enablePush();
  await crashTest();
})();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
