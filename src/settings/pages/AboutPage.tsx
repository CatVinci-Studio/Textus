import { useEffect, useState } from "react";
import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { GuidesSection } from "../sections/guides";
import { LinkRow } from "../sections/controls";
import { UpdateButton, UpdateChannelRow } from "../sections/general";
import { appVersion } from "../../platform/app-info";
import { isDesktopApp } from "../../platform/capabilities";
import { emitMenuEvent } from "../../platform/menu-events";
import { links } from "../../platform/ipc";
import appIcon from "../../../src-tauri/icons/128x128@2x.png";

/** About: Textus and its version, checking for updates and which ones to
 *  take; help; and, last, where Textus lives and who made it. */
export function AboutPage({
  t,
  settings,
  openHelp,
  onClose,
  checkUpdates = false,
}: SettingsPageProps & { checkUpdates?: boolean }) {
  const [version, setVersion] = useState("");
  useEffect(() => {
    appVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);
  return (
    <>
      <div className="settings-about-card">
        <img className="settings-about-card-icon" src={appIcon} alt="" />
        <div className="settings-about-card-text">
          <div className="settings-about-card-name">Textus</div>
          <div className="settings-about-card-version">{version}</div>
        </div>
        <UpdateButton t={t} checkOnOpen={checkUpdates} />
      </div>
      <SettingsGroup title={t.settingsUpdatesGroup}>
        <UpdateChannelRow t={t} />
      </SettingsGroup>
      <SettingsGroup title={t.settingsHelpGroup}>
        {isDesktopApp && (
          <LinkRow
            label={t.menuHelpWelcome}
            onOpen={() => openHelp("welcome")}
          />
        )}
        <GuidesSection t={t} language={settings.language} openHelp={openHelp} />
        {isDesktopApp && (
          <LinkRow
            label={t.menuHelpReport}
            onOpen={() => {
              onClose();
              emitMenuEvent("help-report");
            }}
          />
        )}
        <LinkRow
          label={t.menuHelpCommunity}
          onOpen={() => void links.openCommunityPage(settings.language)}
        />
      </SettingsGroup>
      <p className="settings-about-links">
        <button
          type="button"
          onClick={() => void links.openAboutLink("github")}
        >
          GitHub
        </button>
        {" · "}
        <button
          type="button"
          onClick={() => void links.openAboutLink("discord")}
        >
          Discord
        </button>
        {" · "}
        <button type="button" onClick={() => void links.openAboutLink("qq")}>
          {t.aboutQq}
        </button>
        {" · "}
        {t.aboutMadeBy}
      </p>
    </>
  );
}
