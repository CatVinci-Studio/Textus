import React from "react";
import ReactDOM from "react-dom/client";
import { detectLang, loadLocale, localeOf } from "../i18n/strings";
import { normaliseSettings } from "../prefs/SettingsContext";
import { installScrollReveal } from "../ui/scroll-reveal";
import { installPolyfills } from "../utils/polyfills";
import { installNativeStandIn } from "./native-stand-in";
import { Playground } from "./Playground";
import "./playground.css";

// The browser playground's entry.

installPolyfills();
installNativeStandIn();
installScrollReveal();

// The app's defaults, in the language the link names (`?lang=`), else the
// browser's: no Settings panel, no stored settings. Light or dark follows
// the system.
const asked = new URLSearchParams(window.location.search).get("lang");
const language = detectLang(asked ?? navigator.language);
const settings = { ...normaliseSettings(null), language };
document.documentElement.lang = localeOf(language);

// Its strings load first, as in the app.
void loadLocale(language)
  .catch(() => {})
  .then(() =>
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <Playground settings={settings} />
      </React.StrictMode>,
    ),
  );
