import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";
import { I18nProvider } from "../app/i18n";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider><Home /></I18nProvider>
  </StrictMode>,
);
