import { useRef } from "react";
import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import {
  UI_TEXT_SCALES,
  type UiTextScale,
  type Settings,
} from "../../prefs/SettingsContext";
import { AdvancedFold, SettingRow, ToggleRow } from "../sections/controls";
import { ThemeSection, ThemesTab } from "../sections/theme";
import { Select } from "../../engine/controls/Select";
import { appDrawsWindowFrame } from "../../platform/window-chrome";

/** Appearance: the theme and the theme gallery, and the window itself -
 *  its layout, its text size, the rail and the menu bar. */
export function AppearancePage({
  t,
  settings,
  setSettings,
  phone,
  percent,
}: SettingsPageProps) {
  const gallery = useRef<HTMLElement>(null);
  return (
    <>
      <SettingsGroup title={t.navTheme}>
        <ThemeSection
          t={t}
          onMore={() =>
            gallery.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            })
          }
        />
      </SettingsGroup>
      {/* The gallery draws its own boxes: under a heading, not in one. */}
      <section
        ref={gallery}
        className="settings-group"
        aria-label={t.themeGalleryGroup}
      >
        <h2 className="settings-group-title">{t.themeGalleryGroup}</h2>
        <ThemesTab t={t} />
      </section>
      <SettingsGroup title={t.settingsInterfaceGroup}>
        {/* A phone's UI is sized by iOS's own text styles instead. */}
        {!phone && (
          <SettingRow label={t.uiTextScaleLabel}>
            <Select
              className="settings-select"
              aria-label={t.uiTextScaleLabel}
              value={String(settings.uiTextScale)}
              onChange={(e) =>
                setSettings({
                  uiTextScale: Number(e.target.value) as UiTextScale,
                })
              }
            >
              {UI_TEXT_SCALES.map((scale) => (
                <option key={scale} value={String(scale)}>
                  {percent.format(scale)}
                </option>
              ))}
            </Select>
          </SettingRow>
        )}
        {!phone && (
          <SettingRow label={t.layoutLabel}>
            <Select
              className="settings-select"
              aria-label={t.layoutLabel}
              value={settings.layout}
              onChange={(e) =>
                setSettings({
                  layout: e.target.value as Settings["layout"],
                })
              }
            >
              <option value="islands">{t.layoutIslands}</option>
              <option value="classic">{t.layoutClassic}</option>
            </Select>
          </SettingRow>
        )}
        <ToggleRow
          label={t.activityRailLabel}
          help={t.activityRailHelp}
          checked={settings.activityRail}
          onChange={(on) => setSettings({ activityRail: on })}
        />
        {appDrawsWindowFrame && (
          <ToggleRow
            label={t.menuBarLabel}
            help={t.menuBarHelp}
            checked={settings.menuBarShown}
            onChange={(on) => setSettings({ menuBarShown: on })}
          />
        )}
      </SettingsGroup>
      <AdvancedFold t={t}>
        <ToggleRow
          label={t.frostedTitleBarLabel}
          help={t.frostedTitleBarHelp}
          checked={!settings.solidTitleBar}
          onChange={(on) => setSettings({ solidTitleBar: !on })}
        />
      </AdvancedFold>
    </>
  );
}
