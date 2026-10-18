import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Lang, Strings } from "../../i18n/strings";
import { links } from "../../platform/ipc";
import { LevisImportSection, UpdateButton, UpdateChannelRow } from "./general";
import appIcon from "../../../src-tauri/icons/128x128@2x.png";

/** Settings › General › About Textus: the app, its version and updates,
 *  its code, where to talk with us, and who made it - and, for the few who
 *  still have a Levis installation, bringing it in. */
export function AboutSection({ t, lang }: { t: Strings; lang: Lang }) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  return (
    <div className="settings-about">
      <img className="settings-about-icon" src={appIcon} alt="" />
      <div className="settings-about-name">Textus</div>
      <div className="settings-about-version">
        {version ? t.aboutVersion.replace("{version}", version) : " "}
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
      <UpdateChannelRow t={t} />
      <LevisImportSection t={t} lang={lang} />
      <div className="settings-about-credit">{t.aboutMadeBy}</div>
    </div>
  );
}
