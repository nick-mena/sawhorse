import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts (the desktop app works offline): one humanist family and a matching mono.
import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/500.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/noto-sans-mono/400.css";
import "@fontsource/noto-sans-mono/500.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/drawings.css";
import { App } from "./App";

// ?theme=dark or ?theme=light forces a theme (screenshots, demos); otherwise follow the OS.
try {
  const theme = new URLSearchParams(location.search).get("theme");
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
} catch {
  /* no location in some hosts */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
