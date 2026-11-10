import { useEffect, useMemo, useState } from "react";
import { fontChoices } from "./font-choices";
import type { Strings } from "../../i18n/strings";
import { systemIpc } from "../../platform/ipc";
import {
  DOC_LETTER_SPACINGS,
  DOC_LINE_SPACINGS,
  DOC_TEXT_SIZES,
  LETTER_SPACING_BY,
  type DocLetterSpacing,
  type DocLineSpacing,
  type DocTextSize,
} from "../../prefs/SettingsContext";
import type { SettingsPageProps } from "../pages/types";
import { letterSpacingBy } from "../../prefs/settings-normalise";
import { Select } from "../../engine/controls/Select";
import { SettingRow } from "./controls";
import { ChevronIcon } from "../../engine/controls/icons";

/** The reader's own size, spacing and font for the document, over the
 *  theme's: folded under one row that says whether any is set. */

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

const LINE_SPACING_LABELS: Record<DocLineSpacing, keyof Strings> = {
  auto: "docLineSpacingAuto",
  compact: "docLineSpacingCompact",
  standard: "docLineSpacingStandard",
  relaxed: "docLineSpacingRelaxed",
};

const SPACING_LABELS: Record<DocLetterSpacing, keyof Strings> = {
  auto: "docLetterSpacingAuto",
  normal: "docLetterSpacingNormal",
  expanded: "docLetterSpacingExpanded",
  condensed: "docLetterSpacingCondensed",
};

type Props = Pick<SettingsPageProps, "t" | "settings" | "setSettings">;

export function DocTextFold({ t, settings, setSettings }: Props) {
  const custom =
    settings.docTextSize !== "auto" ||
    settings.docLineSpacing !== "auto" ||
    settings.docFont !== "" ||
    settings.docLetterSpacing !== "auto";
  return (
    <details className="settings-fold">
      <summary className="settings-row">
        <span className="settings-row-label">{t.docTextLabel}</span>
        <span className="settings-row-value">
          {custom ? t.docTextCustom : t.docTextSizeAuto}
        </span>
        <ChevronIcon className="settings-fold-chevron" />
      </summary>
      <div className="settings-fold-body">
        <FontRow t={t} settings={settings} setSettings={setSettings} />
        <SettingRow label={t.docTextSizeLabel}>
          <Select
            className="settings-select"
            aria-label={t.docTextSizeLabel}
            value={String(settings.docTextSize)}
            onChange={(e) =>
              setSettings({
                docTextSize: (e.target.value === "auto"
                  ? "auto"
                  : Number(e.target.value)) as DocTextSize,
              })
            }
          >
            {DOC_TEXT_SIZES.map((size) => (
              <option key={size} value={String(size)}>
                {size === "auto" ? t.docTextSizeAuto : `${size} px`}
              </option>
            ))}
          </Select>
        </SettingRow>
        <LetterSpacingRow t={t} settings={settings} setSettings={setSettings} />
        <SettingRow label={t.docLineSpacingLabel}>
          <Select
            className="settings-select"
            aria-label={t.docLineSpacingLabel}
            value={settings.docLineSpacing}
            onChange={(e) =>
              setSettings({
                docLineSpacing: e.target.value as DocLineSpacing,
              })
            }
          >
            {DOC_LINE_SPACINGS.map((spacing) => (
              <option key={spacing} value={spacing}>
                {t[LINE_SPACING_LABELS[spacing]] as string}
              </option>
            ))}
          </Select>
        </SettingRow>
      </div>
    </details>
  );
}

function FontRow({ t, settings, setSettings }: Props) {
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void fontFamilies().then((list) => live && setFonts(list));
    return () => {
      live = false;
    };
  }, []);
  const { recommended, more } = useMemo(
    () => fontChoices(fonts, settings.language),
    [fonts, settings.language],
  );
  // A font chosen on another machine still shows as the choice.
  const chosenElsewhere =
    settings.docFont &&
    !recommended.includes(settings.docFont) &&
    !more.includes(settings.docFont);
  return (
    <SettingRow label={t.docFontLabel}>
      <Select
        className="settings-select"
        aria-label={t.docFontLabel}
        value={settings.docFont}
        onChange={(e) => setSettings({ docFont: e.target.value })}
      >
        <option value="">{t.docFontAuto}</option>
        {chosenElsewhere && (
          <option value={settings.docFont}>{settings.docFont}</option>
        )}
        {recommended.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        {more.length > 0 && (
          <optgroup label={t.docFontMore}>
            {more.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
    </SettingRow>
  );
}

/** Word-style character spacing: expanded or condensed by a number of pt. */
function LetterSpacingRow({ t, settings, setSettings }: Props) {
  const [by, setBy] = useState(String(settings.docLetterSpacingBy));
  useEffect(
    () => setBy(String(settings.docLetterSpacingBy)),
    [settings.docLetterSpacingBy],
  );
  const commitBy = () => {
    const value = letterSpacingBy(by);
    setBy(String(value));
    setSettings({ docLetterSpacingBy: value });
  };
  const adjustable =
    settings.docLetterSpacing === "expanded" ||
    settings.docLetterSpacing === "condensed";
  return (
    <SettingRow label={t.docLetterSpacingLabel}>
      <div className="settings-letter-spacing">
        <Select
          className="settings-select"
          aria-label={t.docLetterSpacingLabel}
          value={settings.docLetterSpacing}
          onChange={(e) =>
            setSettings({
              docLetterSpacing: e.target.value as DocLetterSpacing,
            })
          }
        >
          {DOC_LETTER_SPACINGS.map((spacing) => (
            <option key={spacing} value={spacing}>
              {t[SPACING_LABELS[spacing]] as string}
            </option>
          ))}
        </Select>
        {adjustable && (
          <label className="settings-letter-spacing-by">
            <input
              className="settings-text-input"
              inputMode="decimal"
              aria-label={t.docLetterSpacingBy}
              value={by}
              onChange={(e) => setBy(e.target.value)}
              onBlur={commitBy}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitBy();
                const step =
                  e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const value = letterSpacingBy(
                  settings.docLetterSpacingBy + step * LETTER_SPACING_BY.step,
                );
                setSettings({ docLetterSpacingBy: value });
              }}
            />
            pt
          </label>
        )}
      </div>
    </SettingRow>
  );
}
