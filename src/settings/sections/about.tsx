import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Strings } from "../../i18n/strings";
import { useSettings } from "../SettingsContext";
import { useProviderCatalog } from "../../ai/provider-catalog";
import { isDesktopApp } from "../../platform/capabilities";
import { links } from "../../platform/ipc";
import { fetchConnected } from "./providers";
import { UpdateButton } from "./general";
import appIcon from "../../../src-tauri/icons/128x128@2x.png";

/** Taps on the version, close enough together, that open or close the
 *  hidden diary (ai/magic-diary/diary-mode.ts). */
const DIARY_TAPS = 5;
const TAP_GAP_MS = 1_200;

/** Whether the selected AI provider is signed in or has its key: the
 *  diary answers through it. */
function useAiConnected(provider: string): boolean {
  const catalog = useProviderCatalog();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const entry = catalog.find((e) => e.id === provider);
    if (!entry) {
      setConnected(false);
      return;
    }
    let live = true;
    fetchConnected(entry)
      .then((c) => live && setConnected(c.oauth || c.apiKey))
      .catch(() => live && setConnected(false));
    return () => {
      live = false;
    };
  }, [catalog, provider]);
  return connected;
}

/** Settings › General › About Textus: the app, its version and updates,
 *  its code, where to talk with us and who made it - and,
 *  behind the version, the diary. Five taps open it once an AI provider is
 *  connected (the settings close, and the page is the book); five more
 *  close it. Without a provider the taps do nothing at all. */
export function AboutSection({
  t,
  onClose,
}: {
  t: Strings;
  onClose: () => void;
}) {
  const { settings, setSettings } = useSettings();
  const [version, setVersion] = useState("");
  const aiConnected = useAiConnected(settings.aiProvider);
  const taps = useRef({ count: 0, last: 0 });

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  function tapVersion() {
    const now = Date.now();
    const run = taps.current;
    run.count = now - run.last < TAP_GAP_MS ? run.count + 1 : 1;
    run.last = now;
    if (run.count < DIARY_TAPS || !isDesktopApp) return;
    run.count = 0;
    if (settings.enableDiary) {
      setSettings({ enableDiary: false });
      onClose();
    } else if (aiConnected) {
      setSettings({ enableDiary: true });
      onClose();
    }
  }

  return (
    <div className="settings-about">
      <img className="settings-about-icon" src={appIcon} alt="" />
      <div className="settings-about-name">Textus</div>
      {/* Not a button to the eye: nothing says there is more here. */}
      <div className="settings-about-version" onClick={tapVersion}>
        {version ? t.aboutVersion.replace("{version}", version) : " "}
      </div>
      <div className="settings-about-links">
        <button
          type="button"
          className="text-button settings-about-link"
          onClick={() => void links.openAboutLink("github")}
        >
          GitHub
        </button>
        <button
          type="button"
          className="text-button settings-about-link"
          onClick={() => void links.openAboutLink("discord")}
        >
          Discord
        </button>
        <button
          type="button"
          className="text-button settings-about-link"
          onClick={() => void links.openAboutLink("qq")}
        >
          {t.aboutQq}
        </button>
        <UpdateButton t={t} />
      </div>
      <div className="settings-about-credit">{t.aboutMadeBy}</div>
    </div>
  );
}
