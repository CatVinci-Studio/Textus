import { fill } from "../../i18n/fill";
import { useEffect, useState } from "react";
import { appVersion } from "../../platform/app-info";
import type { Strings } from "../../i18n/strings";
import { links } from "../../platform/ipc";
import { isMobileApp } from "../../platform/capabilities";
import { UpdateButton } from "./general";
import appIcon from "../../../src-tauri/icons/128x128@2x.png";

/** Settings › General › About Textus: the app, its version and updates,
 *  its code, where to talk with us, and who made it. */
export function AboutSection({
  t,
  openLicenses,
  checkNow = false,
}: {
  t: Strings;
  /** Opens the open-source licenses as a document. */
  openLicenses: () => void;
  /** Opened from Check for Updates…: check at once. */
  checkNow?: boolean;
}) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    appVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  return (
    <div className="settings-about">
      <img className="settings-about-icon" src={appIcon} alt="" />
      <div className="settings-about-name">Textus</div>
      <div className="settings-about-version">
        {version
          ? fill(isMobileApp ? t.aboutVersionBeta : t.aboutVersion, {
              version,
            })
          : " "}
      </div>
      <div className="settings-about-links">
        <button
          type="button"
          className="tx-button text-button settings-about-link"
          onClick={() => void links.openAboutLink("github")}
        >
          GitHub
        </button>
        <button
          type="button"
          className="tx-button text-button settings-about-link"
          onClick={() => void links.openAboutLink("discord")}
        >
          Discord
        </button>
        <button
          type="button"
          className="tx-button text-button settings-about-link"
          onClick={() => void links.openAboutLink("qq")}
        >
          {t.aboutQq}
        </button>
        <button
          type="button"
          className="tx-button text-button settings-about-link"
          onClick={openLicenses}
        >
          {t.aboutLicenses}
        </button>
        <UpdateButton t={t} checkOnOpen={checkNow} />
      </div>
      <ShareRow t={t} />
      <div className="settings-about-credit">{t.aboutMadeBy}</div>
    </div>
  );
}

/** Passes Textus on: the system's share sheet where the page has one
 *  (iPhone, iPad), else the words copied, `copied` then true. */
export function useShareTextus(t: Strings) {
  const [copied, setCopied] = useState(false);
  const share = () => {
    const text = t.aboutShareText;
    if (typeof navigator.share === "function") {
      void navigator.share({ text }).catch(() => {});
      return;
    }
    void navigator.clipboard.writeText(text).then(() => setCopied(true));
  };
  return { copied, share };
}

/** "Like Textus?" and a button that passes it on: the system's share sheet
 *  where the page has one (iPhone, iPad), else the words copied. */
function ShareRow({ t }: { t: Strings }) {
  const { copied, share } = useShareTextus(t);
  return (
    <div className="settings-about-share">
      <span>{t.aboutShareLead}</span>
      <button
        type="button"
        className="tx-button text-button settings-about-link"
        onClick={share}
      >
        {copied ? t.codeBlockCopied : t.aboutShare}
      </button>
    </div>
  );
}
