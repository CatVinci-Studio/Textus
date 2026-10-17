import React from "react";
import ReactDOM from "react-dom/client";
import { detectLang, localeOf } from "../i18n/strings";
import { normaliseSettings } from "../settings/SettingsContext";
import { installScrollReveal } from "../ui/scroll-reveal";
import { installNativeStandIn } from "./native-stand-in";
import { Playground } from "./Playground";
import "./playground.css";

// The browser playground's entry (playground.html, built by
// `npm run build:playground`). The app's own entry is src/main.tsx.

installNativeStandIn();
installScrollReveal();

// The app's defaults, in the browser's language: no Settings panel, no
// stored settings. Light or dark follows the system through base.css.
const language = detectLang(navigator.language);
const settings = { ...normaliseSettings(null), language };
document.documentElement.lang = localeOf(language);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Playground settings={settings} />
  </React.StrictMode>,
);
