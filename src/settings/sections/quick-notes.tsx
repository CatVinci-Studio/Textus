import { useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import { plural } from "../../i18n/plural";
import { quickNote, type QuickNoteShortcutStatus } from "../../platform/ipc";
import { useQuickNoteShortcut } from "../../platform/useQuickNoteShortcut";
import { defaultShortcuts, useSettings } from "../SettingsContext";
import { Select } from "../../ui/Select";
import { errorText } from "../../utils/error-text";
import { isReservedCombo } from "../../utils/shortcuts";
import {
  acceleratorFromEvent,
  acceleratorProblem,
  comboFromAccelerator,
  defaultQuickNoteAccelerator,
  formatAccelerator,
} from "../../utils/accelerator";
import { SettingRow, ToggleRow } from "./controls";

/** Settings › General › Quick Notes' "continue the last note" choices. */
const CONTINUE_MINUTES = [0, 1, 5, 15, 30, 60];

/**
 * Settings › General › Quick Notes: the global shortcut (off until turned
 * on), where notes go and how, and the command that opens one - for
 * Wayland, where no app may register a shortcut, and for opening a note
 * while Textus isn't running. Desktop only. The window itself is
 * src/quick-note/; Rust registers the shortcut and writes the notes
 * (src-tauri/src/commands/quick_note/).
 */
export function QuickNotesSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const status = useQuickNoteShortcut();
  const [folder, setFolder] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);

  useEffect(() => {
    void quickNote
      .folder()
      .then((f) => setFolder(f?.path ?? null))
      .catch(() => {});
  }, [settings.quickNoteFolder, settings.language]);

  async function changeFolder() {
    const picked = await quickNote.pickFolder().catch(() => null);
    if (picked) setSettings({ quickNoteFolder: picked });
  }

  async function showFolder() {
    setFolderError(null);
    try {
      await quickNote.openFolder();
    } catch (err) {
      setFolderError(errorText(err));
    }
  }

  return (
    <>
      <ToggleRow
        label={t.quickNoteShortcutToggle}
        hint={t.quickNoteShortcutHint}
        checked={settings.quickNoteShortcutEnabled}
        onChange={(v) => setSettings({ quickNoteShortcutEnabled: v })}
      />
      {settings.quickNoteShortcutEnabled && (
        <QuickNoteShortcutRow t={t} status={status} />
      )}
      <SettingRow
        label={t.quickNoteFolderLabel}
        hint={folder ?? undefined}
        error={folderError}
      >
        <button
          type="button"
          className="text-button settings-inline-button"
          onClick={() => void changeFolder()}
        >
          {t.quickNoteFolderChange}
        </button>
        <button
          type="button"
          className="text-button settings-inline-button"
          onClick={() => void showFolder()}
        >
          {t.quickNoteFolderShow}
        </button>
      </SettingRow>
      <ToggleRow
        label={t.quickNotePerDayLabel}
        hint={t.quickNotePerDayHint}
        checked={settings.quickNotePerDay}
        onChange={(v) => setSettings({ quickNotePerDay: v })}
      />
      <SettingRow
        label={t.quickNoteContinueLabel}
        hint={t.quickNoteContinueHint}
      >
        <Select
          className="settings-select"
          aria-label={t.quickNoteContinueLabel}
          value={String(settings.quickNoteContinueMinutes)}
          onChange={(e) =>
            setSettings({ quickNoteContinueMinutes: Number(e.target.value) })
          }
        >
          {(CONTINUE_MINUTES.includes(settings.quickNoteContinueMinutes)
            ? CONTINUE_MINUTES
            : [...CONTINUE_MINUTES, settings.quickNoteContinueMinutes].sort(
                (a, b) => a - b,
              )
          ).map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes === 0
                ? t.quickNoteContinueNever
                : plural(
                    t.quickNoteContinueMinutes,
                    minutes,
                    settings.language,
                  )}
            </option>
          ))}
        </Select>
      </SettingRow>
      <QuickNoteCommandRow t={t} />
    </>
  );
}

/** The status line under the shortcut: what the OS made of it. */
function statusText(
  t: Strings,
  status: QuickNoteShortcutStatus | null,
  shown: string,
): { text: string; error: boolean } | null {
  if (!status) return null;
  switch (status.state) {
    case "on":
      return {
        text: t.quickNoteStatusOn.replace("{combo}", shown),
        error: false,
      };
    case "inUse":
      return {
        text: t.quickNoteStatusInUse.replace("{combo}", shown),
        error: true,
      };
    case "wayland":
      return { text: t.quickNoteStatusWayland, error: true };
    case "invalid":
      return {
        text:
          status.reason === "altGr"
            ? t.quickNoteStatusAltGr
            : status.reason === "reserved"
              ? t.quickNoteStatusReserved
              : t.quickNoteShortcutTooFew,
        error: true,
      };
    default:
      return null;
  }
}

/** Record a combination, as Settings › Shortcuts' rows do - but by the
 *  physical key (utils/accelerator.ts), the way the OS will match it. */
function QuickNoteShortcutRow({
  t,
  status,
}: {
  t: Strings;
  status: QuickNoteShortcutStatus | null;
}) {
  const { settings, setSettings } = useSettings();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const accelerator =
    settings.quickNoteShortcut || defaultQuickNoteAccelerator();
  const shown = formatAccelerator(accelerator);

  useEffect(() => {
    if (!recording) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        setRecording(false);
        return;
      }
      const captured = acceleratorFromEvent(e);
      if (!captured) return;
      // Textus's own keys, as bound now and as they come.
      const taken = [
        ...Object.values(settings.shortcuts),
        ...Object.values(defaultShortcuts()),
      ].filter(Boolean);
      const combo = comboFromAccelerator(captured);
      const problem =
        combo && isReservedCombo(combo)
          ? "inApp"
          : acceleratorProblem(captured, taken);
      if (problem) {
        setError(
          problem === "inApp"
            ? t.quickNoteShortcutInApp
            : t.quickNoteShortcutTooFew,
        );
        return;
      }
      setError("");
      setSettings({ quickNoteShortcut: captured });
      setRecording(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, settings.shortcuts, setSettings, t]);

  const line = statusText(t, status, shown);
  return (
    <div className="shortcut-setting">
      <div className="settings-row">
        <span className="settings-row-label">{t.quickNoteShortcutLabel}</span>
        <div className="shortcut-row-controls">
          <button
            type="button"
            className={`text-button settings-inline-button shortcut-capture-button ${recording ? "shortcut-capture-active" : ""}`}
            aria-label={`${t.quickNoteShortcutLabel}: ${recording ? t.shortcutRecording : shown}`}
            aria-pressed={recording}
            onClick={() => {
              setError("");
              setRecording(true);
            }}
            onBlur={() => setRecording(false)}
          >
            {recording ? t.shortcutRecording : shown}
          </button>
          {settings.quickNoteShortcut && !recording && (
            <button
              type="button"
              className="text-button settings-inline-button"
              onClick={() => {
                setError("");
                setSettings({ quickNoteShortcut: "" });
              }}
            >
              {t.quickNoteShortcutDefault}
            </button>
          )}
        </div>
      </div>
      {error ? (
        <div className="settings-error" role="alert">
          {error}
        </div>
      ) : (
        line && (
          <div
            className={line.error ? "settings-error" : "settings-row-hint"}
            role="status"
            data-quick-note-status={status?.state}
          >
            {line.text}
          </div>
        )
      )}
    </div>
  );
}

/** The command that opens a quick note, to copy into a desktop's shortcut
 *  settings or a launcher. */
function QuickNoteCommandRow({ t }: { t: Strings }) {
  const [command, setCommand] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void quickNote
      .cliCommand()
      .then(setCommand)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  if (!command) return null;
  return (
    <SettingRow
      label={t.quickNoteCommandLabel}
      hint={
        <>
          <code className="settings-inline-code quick-note-command">
            {command}
          </code>
          <div>{t.quickNoteCommandHint}</div>
        </>
      }
    >
      <button
        type="button"
        className="text-button settings-inline-button"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(command)
            .then(() => setCopied(true))
            .catch(() => {});
        }}
      >
        {copied ? t.quickNoteCommandCopied : t.quickNoteCommandCopy}
      </button>
    </SettingRow>
  );
}
