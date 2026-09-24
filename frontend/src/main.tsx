import React from "react";
import ReactDOM from "react-dom/client";

import { AuthGate } from "./components/AuthGate";
import { DesktopDisclosure } from "./components/DesktopDisclosure";
import "./index.css";

// Desktop shell (Electron preload) may set window.tvashtrDesktop — mark <html> so CSS/FE
// can later hide web-only chrome without a large rewrite in this slice.
if (window.tvashtrDesktop) {
  document.documentElement.dataset.tvashtrDesktop = "true";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate />
    <DesktopDisclosure />
  </React.StrictMode>,
);
