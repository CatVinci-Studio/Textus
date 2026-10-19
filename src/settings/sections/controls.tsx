import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  useSettings,
  type HeadingAction,
  type ShortcutAction,
  type Shortcuts,
} from "../SettingsContext";
import { resolveStrings, type Strings } from "../../i18n/strings";
import type { FixedShortcutGroup } from "../../app/fixed-shortcuts";
import {
  comboFromEvent,
  isBindableCombo,
  formatCombo,
  isReservedCombo,
} from "../../utils/shortcuts";
import { ChevronIcon } from "../../ui/icons";
import { InfoTip } from "../../ui/InfoTip";

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
 * every row in Settings takes, on the desktop and the phone alike.
 *
 * The label says what the setting does, so most rows need nothing else.
 * `help` is the explanation a label can't carry - a trade-off, what
 * happens behind the scenes - behind a "?" after the label, never as grey
 * text on the page. `hint` is for what is live rather than explained: a
 * value (the folder in use, a fetched-on date, the link a pasted image
 * gets) or a status (no room for the margin, a shortcut in use).
 */
export function SettingRow({
  label,
  help,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">
          {label}
          {help && <RowHelp label={label}>{help}</RowHelp>}
        </div>
        {hint && <div className="settings-row-hint">{hint}</div>}
        {error && <div className="settings-error">{error}</div>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}

/** A row's "?" (ui/InfoTip.tsx), named after the row: "More about …". */
export function RowHelp({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  const { settings } = useSettings();
  const t = resolveStrings(settings.language);
  return (
    <InfoTip
      label={
        typeof label === "string"
          ? t.infoTipLabel.replace("{label}", label)
          : t.infoTipLabelPlain
      }
    >
      {children}
    </InfoTip>
  );
}

/** A row that opens something - a guide as a document, a page of Settings:
 *  the whole row is the button. */
export function LinkRow({
  label,
  onOpen,
  className,
}: {
  label: string;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`settings-row settings-link-row${className ? ` ${className}` : ""}`}
      onClick={onOpen}
    >
      <span className="settings-row-label">{label}</span>
      <ChevronIcon className="settings-link-chevron" />
    </button>
  );
}

/**
 * A switch row; the whole row toggles it. `help` as SettingRow's.
 * The switch is named by the label alone (aria-labelledby): the "?" sits
 * inside the <label>, and would otherwise be read as part of the name.
 */
export function ToggleRow({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="settings-row settings-toggle-row" htmlFor={id}>
      <div className="settings-row-text">
        <div className="settings-row-label">
          <span id={`${id}-label`}>{label}</span>
          {help && <RowHelp label={label}>{help}</RowHelp>}
        </div>
      </div>
      <input
        id={id}
        type="checkbox"
        aria-labelledby={`${id}-label`}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** The heading shortcuts' names: the Format menu's own, and Paragraph. */
export function headingLabels(t: Strings): Record<HeadingAction, string> {
  const level = (n: number) => t.menuHeadingTemplate.replace("{n}", String(n));
  return {
    setHeading1: level(1),
    setHeading2: level(2),
    setHeading3: level(3),
    setHeading4: level(4),
    setHeading5: level(5),
    setHeading6: level(6),
    setParagraph: t.shortcutParagraph,
  };
}

/** The shortcuts that can't be changed (app/fixed-shortcuts.ts), read-only,
 *  by the menu they belong to. */
export function FixedShortcutList({
  groups,
}: {
  groups: FixedShortcutGroup[];
}) {
  return (
    <div className="shortcut-fixed">
      {groups.map((group) => (
        <section key={group.title} className="shortcut-fixed-section">
          <h3 className="shortcut-fixed-title">{group.title}</h3>
          <dl className="shortcut-fixed-list">
            {group.items.map((item) => (
              <div key={item.label} className="shortcut-fixed-row">
                <dt>{item.label}</dt>
                <dd>
                  {item.combos.map((combo) => (
                    <kbd key={combo}>{formatCombo(combo)}</kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
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
      toggleSplitView: t.shortcutToggleSplitView,
      toggleZenMode: t.shortcutToggleZenMode,
      toggleSourceMode: t.shortcutToggleSourceMode,
      toggleTypewriterMode: t.shortcutToggleTypewriterMode,
      searchFiles: t.shortcutSearchFiles,
      nextTab: t.shortcutNextTab,
      previousTab: t.shortcutPreviousTab,
      ...headingLabels(t),
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
