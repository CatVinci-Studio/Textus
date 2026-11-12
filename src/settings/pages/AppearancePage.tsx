import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import {
  UI_TEXT_SCALES,
  type UiTextScale,
  type Settings,
} from "../../prefs/SettingsContext";
import { AdvancedFold, SettingRow, ToggleRow } from "../sections/controls";
import { CustomCssRow, ThemeSection, ThemesTab } from "../sections/theme";
import { Select } from "../../engine/controls/Select";
import { appDrawsWindowFrame } from "../../platform/window-chrome";

/** Appearance › Basics: the layout, light or dark, the editor's theme and
 *  importing one, the interface's size, the rail and the menu bar; one's
 *  own CSS under Advanced. */
export function AppearancePage({
  t,
  settings,
  setSettings,
  percent,
}: SettingsPageProps) {
  return (
    <>
      <SettingsGroup title={t.navAppearance}>
        <ThemeSection t={t} />
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
        <SettingRow label={t.layoutLabel}>
          <Select
            className="settings-select"
            aria-label={t.layoutLabel}
            value={settings.layout}
            onChange={(e) =>
              setSettings({ layout: e.target.value as Settings["layout"] })
            }
          >
            <option value="islands">{t.layoutIslands}</option>
            <option value="classic">{t.layoutClassic}</option>
          </Select>
        </SettingRow>
        <ToggleRow
          label={t.activityRailLabel}
          checked={settings.activityRail}
          onChange={(on) => setSettings({ activityRail: on })}
        />
        {appDrawsWindowFrame && (
          <ToggleRow
            label={t.menuBarLabel}
            checked={settings.menuBarShown}
            onChange={(on) => setSettings({ menuBarShown: on })}
          />
        )}
      </SettingsGroup>
      <AdvancedFold t={t}>
        <CustomCssRow t={t} />
      </AdvancedFold>
    </>
  );
}

/** Appearance › Theme store: the themes installed, then the gallery's. */
export function ThemeStorePage({ t }: SettingsPageProps) {
  return <ThemesTab t={t} />;
}
