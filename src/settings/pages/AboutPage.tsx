import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { AboutSection } from "../sections/about";
import { GuidesSection } from "../sections/guides";
import { LinkRow } from "../sections/controls";
import { isDesktopApp } from "../../platform/capabilities";
import { emitMenuEvent } from "../../platform/menu-events";
import { links } from "../../platform/ipc";

/** About: Textus, its version and updates; the guides; and where to get
 *  help - the tour, a problem report, the community. */
export function AboutPage({
  t,
  settings,
  openHelp,
  onClose,
  checkUpdates = false,
}: SettingsPageProps & { checkUpdates?: boolean }) {
  return (
    <>
      <AboutSection t={t} checkNow={checkUpdates} />
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
      </SettingsGroup>
    </>
  );
}
