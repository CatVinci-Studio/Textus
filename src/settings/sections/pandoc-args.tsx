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

/** One format's arguments, typed as a command line and kept as its words;
 *  one the export owns is refused with its reason. */
function ArgsInput({ t, format }: { t: Strings; format: PandocArgsFormat }) {
  const { settings, setSettings } = useSettings();
  const [text, setText] = useState(
    joinCommandLine(settings.pandocArgs[format] ?? []),
  );
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    const args = splitCommandLine(text);
    const owned = await exportDoc.checkPandocArgs(args);
    setError(owned === null ? null : fill(t.pandocArgsOwned, { arg: owned }));
    if (owned === null)
      setSettings({ pandocArgs: { ...settings.pandocArgs, [format]: args } });
  }

  return (
    <SettingRow label={formatName(t, format)} error={error}>
      <input
        type="text"
        {...VERBATIM_INPUT}
        className="settings-text-input"
        aria-label={`${t.pandocArgsLabel}: ${formatName(t, format)}`}
        placeholder="--toc-depth=2"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
        }}
      />
    </SettingRow>
  );
}

/** Settings › Editor › Advanced: the user's own Pandoc arguments, by format. */
export function PandocArgsRows({ t }: { t: Strings }) {
  const [format, setFormat] = useState<PandocArgsFormat>("all");
  return (
    <>
      <SettingRow label={t.pandocArgsLabel} help={t.pandocArgsHelp}>
        <Select
          className="settings-select"
          aria-label={t.pandocArgsLabel}
          value={format}
          onChange={(e) => setFormat(e.target.value as PandocArgsFormat)}
        >
          {PANDOC_ARGS_FORMATS.map((f) => (
            <option key={f} value={f}>
              {formatName(t, f)}
            </option>
          ))}
        </Select>
      </SettingRow>
      <ArgsInput key={format} t={t} format={format} />
    </>
  );
}
