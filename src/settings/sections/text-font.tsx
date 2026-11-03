import { useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import { systemIpc } from "../../platform/ipc";
import {
  DOC_LETTER_SPACINGS,
  LETTER_SPACING_BY,
  type DocLetterSpacing,
} from "../../prefs/SettingsContext";
import type { SettingsPageProps } from "../pages/types";
import { letterSpacingBy } from "../../prefs/settings-normalise";
import { Select } from "../../ui/Select";
import { SettingRow } from "./controls";

/** The text font and Word-style character spacing, over the theme's. */

let families: Promise<string[]> | null = null;
/** Read once per session: the list is a few hundred names and rarely
 *  changes while Textus runs. */
function fontFamilies(): Promise<string[]> {
  families ??= systemIpc.fontFamilies().catch(() => []);
  return families;
}

const SPACING_LABELS: Record<DocLetterSpacing, keyof Strings> = {
  auto: "docLetterSpacingAuto",
  normal: "docLetterSpacingNormal",
  expanded: "docLetterSpacingExpanded",
  condensed: "docLetterSpacingCondensed",
};

export function TextFontRows({
  t,
  settings,
  setSettings,
}: Pick<SettingsPageProps, "t" | "settings" | "setSettings">) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [by, setBy] = useState(String(settings.docLetterSpacingBy));
  useEffect(() => {
    let live = true;
    void fontFamilies().then((list) => live && setFonts(list));
    return () => {
      live = false;
    };
  }, []);
  useEffect(
    () => setBy(String(settings.docLetterSpacingBy)),
    [settings.docLetterSpacingBy],
  );
  // A font chosen on another machine still shows as the choice.
  const listed =
    settings.docFont && !fonts.includes(settings.docFont)
      ? [settings.docFont, ...fonts]
      : fonts;
  const commitBy = () => {
    const value = letterSpacingBy(by);
    setBy(String(value));
    setSettings({ docLetterSpacingBy: value });
  };
  const adjustable =
    settings.docLetterSpacing === "expanded" ||
    settings.docLetterSpacing === "condensed";
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
    </>
  );
}
