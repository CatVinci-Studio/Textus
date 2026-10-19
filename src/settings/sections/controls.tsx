import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ShortcutAction, Shortcuts } from "../SettingsContext";
import type { Strings } from "../../i18n/strings";
import {
  comboFromEvent,
  isBindableCombo,
  formatCombo,
  isReservedCombo,
} from "../../utils/shortcuts";

// Generic row controls shared by the settings categories.

/**
 * For a field that takes a machine-read value - a URL, a host, a model or
 * field name - rather than prose. iOS capitalises the first letter of a
 * text field and autocorrects it, with the software keyboard and a hardware
 * one alike: "Http://..." still connected, but "Mock-model" or "Gpt-..."
 * is a model id the provider rejects. Spread onto the <input>.
 */
export const VERBATIM_INPUT = {
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false,
} as const;

/**
 * One setting: its name on the left, its control on the right - the shape
 * every row in Settings takes, on the desktop and the phone alike. `hint`
 * is for the few rows whose label can't say enough on its own (a value
 * such as the folder in use, a fetched-on date); most rows have none, so
 * the page reads as a list of names rather than paragraphs of grey text.
 */
export function SettingRow({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {hint && <div className="settings-row-hint">{hint}</div>}
        {error && <div className="settings-error">{error}</div>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-row settings-toggle-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export function ShortcutRow({
  label,
  action,
  shortcuts,
  setSettings,
  t,
}: {
  label: string;
  action: ShortcutAction;
  shortcuts: Shortcuts;
  setSettings: (patch: { shortcuts: Shortcuts }) => void;
  t: Strings;
}) {
  const [recording, setRecording] = useState(false);
  const combo = shortcuts[action];
  const [error, setError] = useState("");
  const actionLabels = useMemo<Record<ShortcutAction, string>>(
    () => ({
      triggerCompletion: t.shortcutTriggerCompletion,
      triggerGrammarCheck: t.shortcutTriggerGrammarCheck,
      toggleFloatingChat: t.shortcutToggleFloatingChat,
      findReplace: t.shortcutFindReplace,
      toggleSidebar: t.shortcutToggleSidebar,
      toggleAgentPanel: t.shortcutToggleAgentPanel,
      toggleSurface: t.shortcutToggleSurface,
      toggleSplitView: t.shortcutToggleSplitView,
      toggleZenMode: t.shortcutToggleZenMode,
      toggleSourceMode: t.shortcutToggleSourceMode,
      toggleTypewriterMode: t.shortcutToggleTypewriterMode,
    }),
    [t],
  );

  useEffect(() => {
    if (!recording) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const captured = comboFromEvent(e);
      if (!captured || !isBindableCombo(captured)) return;
      if (isReservedCombo(captured)) {
        setError(t.shortcutReserved);
        return;
      }
      const conflict = (Object.keys(shortcuts) as ShortcutAction[]).find(
        (other) => other !== action && shortcuts[other] === captured,
      );
      if (conflict) {
        setError(
          t.shortcutConflict.replace("{action}", actionLabels[conflict]),
        );
        return;
      }
      setError("");
      setSettings({ shortcuts: { ...shortcuts, [action]: captured } });
      setRecording(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, shortcuts, setSettings, action, actionLabels, t]);

  function clear() {
    setError("");
    setSettings({ shortcuts: { ...shortcuts, [action]: "" } });
  }

  return (
    <div className="shortcut-setting">
      <div className="settings-row">
        <span className="settings-row-label">{label}</span>
        <div className="shortcut-row-controls">
          <button
            className={`text-button settings-inline-button shortcut-capture-button ${recording ? "shortcut-capture-active" : ""}`}
            aria-label={`${label}: ${recording ? t.shortcutRecording : combo ? formatCombo(combo) : t.shortcutUnset}`}
            aria-pressed={recording}
            onClick={() => {
              setError("");
              setRecording(true);
            }}
            onBlur={() => setRecording(false)}
          >
            {recording
              ? t.shortcutRecording
              : combo
                ? formatCombo(combo)
                : t.shortcutUnset}
          </button>
          {combo && !recording && (
            <button
              className="text-button settings-inline-button"
              aria-label={`${t.shortcutClear}: ${label}`}
              onClick={clear}
            >
              {t.shortcutClear}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
