import { fill } from "../../i18n/fill";
import type { Strings, TextKey } from "../../i18n/strings";
import type { Settings } from "../../prefs/SettingsContext";
import { BUILTIN_CONTENT_THEMES } from "../../prefs/builtin-themes";
import { Select } from "../../engine/controls/Select";
import { showQuickPick } from "../../engine/controls/quick-pick-queue";
import { SettingsGroup } from "../pages/SettingsGroup";
import { SettingRow } from "../sections/controls";
import { NumberField, clampToRange } from "../../engine/controls/NumberField";
import { PaletteRows } from "./PaletteRows";
import { useFontChoices } from "../sections/font-choices";
import {
  TYPE_RANGES,
  type TypeChoices,
  type TypeFont,
  type TypeMeasure,
} from "../../theme/theme-typography";

const FONT_LABELS: Record<TypeFont, TextKey> = {
  bodyFont: "docFontLabel",
  headingFont: "workshopHeadingFont",
  codeFont: "workshopCodeFont",
};

const MEASURE_LABELS: Record<TypeMeasure, TextKey> = {
  fontSize: "workshopFontSize",
  headingRatio: "workshopHeadingRatio",
  lineHeight: "workshopLineHeight",
  width: "workshopWidth",
  paragraphGap: "workshopParagraphGap",
  indent: "firstLineIndentLabel",
};

/** Each measure's unit after its field. */
const UNITS: Record<TypeMeasure, (t: Strings) => string> = {
  fontSize: () => "px",
  headingRatio: () => "×",
  lineHeight: () => "",
  width: () => "px",
  paragraphGap: () => "em",
  indent: (t) => t.workshopIndentUnit,
};

interface Props {
  t: Strings;
  settings: Settings;
  start: string;
  onStart: (id: string) => void;
  choices: TypeChoices;
  onChoice: (patch: Partial<TypeChoices>) => void;
  /** The starting theme's own measures, shown until one is set. */
  measured: Record<TypeMeasure, number | null> | null;
  /** Swatches in their dark form. */
  dark: boolean;
}

/** The workshop's column of controls: where to start, the three faces,
 *  then the measures. */
export function WorkshopControls({
  t,
  settings,
  start,
  onStart,
  choices,
  onChoice,
  measured,
  dark,
}: Props) {
  return (
    <>
      <SettingsGroup title={t.workshopStartGroup}>
        <SettingRow label={t.workshopStartLabel}>
          <Select
            className="settings-select"
            aria-label={t.workshopStartLabel}
            value={start}
            onChange={(e) => onStart(e.target.value)}
          >
            {BUILTIN_CONTENT_THEMES.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {t[theme.nameKey]}
              </option>
            ))}
            {settings.userThemes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </Select>
        </SettingRow>
      </SettingsGroup>
      <FontRows
        t={t}
        settings={settings}
        choices={choices}
        onChoice={onChoice}
      />
      <SettingsGroup title={t.workshopTypeGroup}>
        {(Object.keys(TYPE_RANGES) as TypeMeasure[]).map((measure) => {
          const range = TYPE_RANGES[measure];
          const theirs = measured?.[measure] ?? null;
          const label = t[MEASURE_LABELS[measure]] as string;
          return (
            <SettingRow key={measure} label={label}>
              <NumberField
                label={label}
                decreaseLabel={fill(t.numberDecrease, { label })}
                increaseLabel={fill(t.numberIncrease, { label })}
                value={choices[measure]}
                placeholder={
                  theirs === null
                    ? null
                    : clampToRange(theirs, range.min, range.max)
                }
                min={range.min}
                max={range.max}
                step={range.step}
                unit={UNITS[measure](t)}
                onChange={(value) => onChoice({ [measure]: value })}
              />
            </SettingRow>
          );
        })}
      </SettingsGroup>
      <PaletteRows t={t} choices={choices} onChoice={onChoice} dark={dark} />
    </>
  );
}

/** The three faces, each picked from the installed fonts by name. */
function FontRows({
  t,
  settings,
  choices,
  onChoice,
}: Pick<Props, "t" | "settings" | "choices" | "onChoice">) {
  const { recommended, more } = useFontChoices(settings.language);
  const pick = async (font: TypeFont, label: string) => {
    const picked = await showQuickPick(
      [
        { label: t.docFontAuto, value: "" },
        ...recommended.map((c) => ({ label: c.label, value: c.value })),
        ...more.map((c) => ({
          label: c.label,
          value: c.value,
          description: t.docFontMore,
        })),
      ],
      fill(t.workshopFontSearch, { label }),
    );
    if (typeof picked === "string") onChoice({ [font]: picked });
  };
  return (
    <SettingsGroup title={t.workshopFontGroup}>
      {(Object.keys(FONT_LABELS) as TypeFont[]).map((font) => {
        const label = t[FONT_LABELS[font]] as string;
        const value = choices[font];
        return (
          <SettingRow key={font} label={label}>
            <button
              type="button"
              className="ui-select settings-select"
              aria-label={label}
              aria-haspopup="dialog"
              onClick={() => void pick(font, label)}
            >
              <span className="tx-truncate ui-select-value">
                {value || t.docFontAuto}
              </span>
            </button>
          </SettingRow>
        );
      })}
    </SettingsGroup>
  );
}
