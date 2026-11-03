import { useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import { systemIpc } from "../../platform/ipc";
import { DOC_LETTER_SPACING } from "../../prefs/SettingsContext";
import type { SettingsPageProps } from "../pages/types";
import { Select } from "../../ui/Select";
import { NumberStepper, type StepperLabels } from "../../ui/NumberStepper";
import { docLetterSpacingNow } from "../../theme/doc-type-now";
import { SettingRow } from "./controls";

/** The text font and character spacing, over the theme's. */

let families: Promise<string[]> | null = null;
/** Read once per session: the list is a few hundred names and rarely
 *  changes while Textus runs. */
function fontFamilies(): Promise<string[]> {
  // Without the native side (the browser build) there is no list.
  families ??= systemIpc
    .fontFamilies()
    .then((list) => (Array.isArray(list) ? list : []))
    .catch(() => []);
  return families;
}

/** A document text stepper's labels: its row's name, "Theme's" for unset. */
export function stepperLabels(t: Strings, label: string): StepperLabels {
  return {
    label,
    unset: t.docTextSizeAuto,
    decrease: t.stepperDecrease,
    increase: t.stepperIncrease,
    reset: t.docUseTheme,
  };
}

export function TextFontRows({
  t,
  settings,
  setSettings,
}: Pick<SettingsPageProps, "t" | "settings" | "setSettings">) {
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void fontFamilies().then((list) => live && setFonts(list));
    return () => {
      live = false;
    };
  }, []);
  // A font chosen on another machine still shows as the choice.
  const listed =
    settings.docFont && !fonts.includes(settings.docFont)
      ? [settings.docFont, ...fonts]
      : fonts;
  return (
    <>
      <SettingRow label={t.docFontLabel}>
        <Select
          className="settings-select"
          aria-label={t.docFontLabel}
          value={settings.docFont}
          onChange={(e) => setSettings({ docFont: e.target.value })}
        >
          <option value="">{t.docFontAuto}</option>
          {listed.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow label={t.docLetterSpacingLabel}>
        <NumberStepper
          value={
            settings.docLetterSpacing === "auto"
              ? null
              : settings.docLetterSpacing
          }
          range={DOC_LETTER_SPACING}
          unit="pt"
          from={docLetterSpacingNow}
          onChange={(points) =>
            setSettings({ docLetterSpacing: points ?? "auto" })
          }
          labels={stepperLabels(t, t.docLetterSpacingLabel)}
        />
      </SettingRow>
    </>
  );
}
