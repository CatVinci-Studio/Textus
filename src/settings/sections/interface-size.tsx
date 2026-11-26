import {
  DESKTOP_UI_TEXT_SCALES,
  UI_TEXT_SCALES,
  type UiTextScale,
} from "../../prefs/settings-values";
import type { SettingsPageProps } from "../pages/types";
import { Select } from "../../engine/controls/Select";
import { SettingRow } from "./controls";
import { isMobileApp } from "../../platform/capabilities";

const SIZE_NAMES = {
  0.85: "uiTextSmall",
  1: "uiTextMedium",
  1.25: "uiTextLarge",
  1.5: "uiTextXLarge",
  1.75: "uiTextXXLarge",
} as const satisfies Record<UiTextScale, string>;

/** The value of the choice that follows the system's text size. */
const SYSTEM = "system";

/** Interface Size: a phone or tablet follows the system's text size unless
 *  a step is picked, and has two steps past Large for it; a desktop has
 *  Small, Medium and Large. */
export function InterfaceSizeRow({
  t,
  settings,
  setSettings,
}: Pick<SettingsPageProps, "t" | "settings" | "setSettings">) {
  const steps = isMobileApp ? UI_TEXT_SCALES : DESKTOP_UI_TEXT_SCALES;
  const followed = isMobileApp && settings.uiSizeFollowsSystem;
  return (
    <SettingRow label={t.uiTextScaleLabel}>
      <Select
        className="settings-select"
        aria-label={t.uiTextScaleLabel}
        value={followed ? SYSTEM : String(settings.uiTextScale)}
        onChange={(e) =>
          setSettings(
            e.target.value === SYSTEM
              ? { uiSizeFollowsSystem: true }
              : {
                  uiSizeFollowsSystem: false,
                  uiTextScale: Number(e.target.value) as UiTextScale,
                },
          )
        }
      >
        {isMobileApp && <option value={SYSTEM}>{t.appearanceSystem}</option>}
        {steps.map((scale) => (
          <option key={scale} value={String(scale)}>
            {t[SIZE_NAMES[scale]]}
          </option>
        ))}
      </Select>
    </SettingRow>
  );
}
