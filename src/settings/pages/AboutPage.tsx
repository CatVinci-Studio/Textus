import { useEffect, useState } from "react";
import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { GuidesSection } from "../sections/guides";
import { LinkRow, SettingRow } from "../sections/controls";
import { UpdateButton } from "../sections/general";
import { appVersion } from "../../platform/app-info";
import { isDesktopApp } from "../../platform/capabilities";
import { emitMenuEvent } from "../../platform/menu-events";
import { links } from "../../platform/ipc";

/** About: the version and updates, the guides, where to get help, and
 *  where Textus lives - rows like every other page's. */
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
      <SettingsGroup>
        <SettingRow label="Textus" hint={t.aboutMadeBy}>
          <span className="settings-row-value">{version}</span>
          <UpdateButton t={t} checkOnOpen={checkUpdates} />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title={t.navGuides}>
        <GuidesSection t={t} language={settings.language} openHelp={openHelp} />
      </SettingsGroup>
      <SettingsGroup title={t.settingsHelpGroup}>
        {isDesktopApp && (
          <LinkRow
            label={t.menuHelpWelcome}
            onOpen={() => openHelp("welcome")}
          />
        )}
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
        <LinkRow
          label="GitHub"
          onOpen={() => void links.openAboutLink("github")}
        />
        <LinkRow
          label="Discord"
          onOpen={() => void links.openAboutLink("discord")}
        />
        <LinkRow
          label={t.aboutQq}
          onOpen={() => void links.openAboutLink("qq")}
        />
      </SettingsGroup>
    </>
  );
}
