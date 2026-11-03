import type { Strings } from "../../i18n/strings";
import {
  DOC_LETTER_SPACING,
  DOC_LINE_SPACING,
  DOC_TEXT_SIZE,
} from "../../prefs/SettingsContext";
import type { SettingsPageProps } from "../pages/types";
import { NumberStepper, type StepperLabels } from "../../ui/NumberStepper";
import {
  docLetterSpacingNow,
  docLineHeightNow,
  docTextSizeNow,
} from "../../theme/doc-type-now";
import { SettingRow } from "./controls";
import { FontPicker } from "./FontPicker";

/** The document's type as the reader sets it over the theme's: size, line
 *  spacing, font and character spacing. Settings › Editor & Appearance and
 *  View › Text Style… show the same rows. */

/** A document text stepper's labels: its row's name, "Theme's" for unset. */
function stepperLabels(t: Strings, label: string): StepperLabels {
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
      <SettingRow label={t.docTextSizeLabel}>
        <NumberStepper
          value={settings.docTextSize === "auto" ? null : settings.docTextSize}
          range={DOC_TEXT_SIZE}
          unit="px"
          from={docTextSizeNow}
          onChange={(size) => setSettings({ docTextSize: size ?? "auto" })}
          labels={stepperLabels(t, t.docTextSizeLabel)}
        />
      </SettingRow>
      <SettingRow label={t.docLineSpacingLabel}>
        <NumberStepper
          value={
            settings.docLineSpacing === "auto" ? null : settings.docLineSpacing
          }
          range={DOC_LINE_SPACING}
          from={docLineHeightNow}
          onChange={(height) =>
            setSettings({ docLineSpacing: height ?? "auto" })
          }
          labels={stepperLabels(t, t.docLineSpacingLabel)}
        />
      </SettingRow>
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
