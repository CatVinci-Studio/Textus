import type { Strings } from "../../i18n/strings";
import { DOC_LETTER_SPACING } from "../../prefs/SettingsContext";
import type { SettingsPageProps } from "../pages/types";
import { NumberStepper, type StepperLabels } from "../../ui/NumberStepper";
import { docLetterSpacingNow } from "../../theme/doc-type-now";
import { SettingRow } from "./controls";
import { FontPicker } from "./FontPicker";

/** The text font and character spacing, over the theme's. */

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
  return (
    <>
      <SettingRow label={t.docFontLabel}>
        <FontPicker
          value={settings.docFont}
          onChange={(docFont) => setSettings({ docFont })}
          lang={settings.language}
          labels={{
            label: t.docFontLabel,
            auto: t.docFontAuto,
            search: t.docFontSearch,
            recent: t.docFontRecent,
            all: t.docFontAll,
            none: t.docFontNone,
          }}
        />
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
