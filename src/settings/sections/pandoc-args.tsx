import { fill } from "../../i18n/fill";
import { useState } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import {
  PANDOC_ARGS_FORMATS,
  type PandocArgsFormat,
} from "../../prefs/settings-values";
import { joinCommandLine, splitCommandLine } from "../../prefs/mcp";
import { exportDoc } from "../../platform/ipc";
import type { Strings } from "../../i18n/strings";
import { Select } from "../../engine/controls/Select";
import { SettingRow, VERBATIM_INPUT } from "./controls";

// Product names, the same in every language.
const FORMAT_NAMES: Record<Exclude<PandocArgsFormat, "all">, string> = {
  docx: "Word",
  latex: "LaTeX",
  epub: "EPUB",
  odt: "ODT",
};

const formatName = (t: Strings, format: PandocArgsFormat) =>
  format === "all" ? t.pandocArgsAll : FORMAT_NAMES[format];

/** Settings › Editing › Export › Advanced: the user's own Pandoc arguments,
 *  in one row: which format, then its arguments typed as a command line and
 *  kept as words; one the export owns is refused with its reason. */
export function PandocArgsRows({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const [format, setFormat] = useState<PandocArgsFormat>("all");
  const argsOf = (f: PandocArgsFormat) =>
    joinCommandLine(settings.pandocArgs[f] ?? []);
  const [text, setText] = useState(() => argsOf("all"));
  const [error, setError] = useState<string | null>(null);

  function choose(next: PandocArgsFormat) {
    setFormat(next);
    setText(argsOf(next));
    setError(null);
  }

  async function commit() {
    const args = splitCommandLine(text);
    const owned = await exportDoc.checkPandocArgs(args);
    setError(owned === null ? null : fill(t.pandocArgsOwned, { arg: owned }));
    if (owned === null)
      setSettings({ pandocArgs: { ...settings.pandocArgs, [format]: args } });
  }

  return (
    <SettingRow label={t.pandocArgsLabel} help={t.pandocArgsHelp} error={error}>
      <div className="settings-inline-buttons">
        <Select
          className="settings-select"
          aria-label={t.pandocArgsFormat}
          value={format}
          onChange={(e) => choose(e.target.value as PandocArgsFormat)}
        >
          {PANDOC_ARGS_FORMATS.map((f) => (
            <option key={f} value={f}>
              {formatName(t, f)}
            </option>
          ))}
        </Select>
        <input
          type="text"
          {...VERBATIM_INPUT}
          className="tx-input settings-text-input"
          aria-label={`${t.pandocArgsLabel}: ${formatName(t, format)}`}
          placeholder="--toc-depth=2"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
          }}
        />
      </div>
    </SettingRow>
  );
}
