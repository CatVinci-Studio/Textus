import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  defaultShortcuts,
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
  hint,
  checked,
  onChange,
}: {
  label: string;
  help?: ReactNode;
  /** What is live under the label - a status, as SettingRow's. */
  hint?: ReactNode;
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
        {hint && <div className="settings-row-hint">{hint}</div>}
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

/**
 * A key or token kept in the system keychain: a password field and Save
 * until one is stored, then "Configured" and Clear - the stored value is
 * never read back into the page. The caller stores and clears it.
 */
/** How a key reads in its field: its first six and last four characters
 *  around ***, enough to tell which key was pasted without showing it; a
 *  short one, still being typed, as dots. */
export function maskKey(key: string): string {
  if (key.length <= 12) return "•".repeat(key.length);
  return `${key.slice(0, 6)}***${key.slice(-4)}`;
}

/** Whether the field's text is selected from end to end (an empty field
 *  counts: whatever comes in is the whole key). */
function wholeSelected(el: HTMLInputElement): boolean {
  return el.selectionStart === 0 && el.selectionEnd === el.value.length;
}

/**
 * A key's field, showing it masked (maskKey). A password field drew a
 * pasted key as a row of dots as long as the key, and offered to save it
 * as a password. The field holds the mask, so every edit is taken before
 * the browser makes it: a paste or typing over the whole field replaces
 * the key, typing at its end adds to it, a deletion takes the last
 * character, or all of it when all is selected.
 */
export function MaskedKeyInput({
  label,
  placeholder,
  value,
  onChange,
  className = "settings-text-input api-key-input",
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  // React's onBeforeInput is a keypress, not the beforeinput a deletion
  // also sends.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onBeforeInput = (e: InputEvent) => {
      if (e.isComposing || e.inputType === "insertFromPaste") return;
      e.preventDefault();
      const { value, onChange } = latest.current;
      const whole = wholeSelected(el) && el.value !== "";
      if (e.inputType.startsWith("delete")) {
        onChange(whole ? "" : value.slice(0, -1));
      } else if (e.data) {
        onChange(whole ? e.data : value + e.data);
      }
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, []);
  return (
    <input
      ref={ref}
      type="text"
      className={className}
      aria-label={label}
      placeholder={placeholder}
      autoComplete="off"
      {...VERBATIM_INPUT}
      value={maskKey(value)}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text").trim();
        onChange(wholeSelected(e.currentTarget) ? text : value + text);
      }}
      // An edit the browser made anyway (an input method's): the field's
      // text is the key unless it still holds the mask.
      onChange={(e) => {
        const text = e.target.value;
        if (!text.includes("***") && !text.includes("•")) onChange(text);
      }}
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => {
        e.preventDefault();
        if (wholeSelected(e.currentTarget)) onChange("");
      }}
    />
  );
}

export function SecretInput({
  t,
  label,
  saved,
  value,
  onChange,
  onSave,
  onClear,
  placeholder = t.apiKeyPlaceholder,
  saveDisabled,
}: {
  t: Strings;
  /** The field's accessible name. */
  label: string;
  saved: boolean;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  placeholder?: string;
  saveDisabled?: boolean;
}) {
  return saved ? (
    <div className="api-key-configured">
      <span className="settings-row-hint">{t.apiKeyConfigured}</span>
      <button className="text-button settings-inline-button" onClick={onClear}>
        {t.apiKeyClear}
      </button>
    </div>
  ) : (
    <div className="api-key-input-row">
      <MaskedKeyInput
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      <button
        className="text-button settings-inline-button"
        onClick={onSave}
        disabled={saveDisabled}
      >
        {t.apiKeySave}
      </button>
    </div>
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
  fixed = [],
}: {
  label: string;
  action: ShortcutAction;
  shortcuts: Shortcuts;
  setSettings: (patch: { shortcuts: Shortcuts }) => void;
  t: Strings;
  /** The shortcuts that can't be changed (app/fixed-shortcuts.ts): a key
   *  one of them owns can't be bound here, as it would never fire - Ctrl+0
   *  for Paragraph is Actual Size. */
  fixed?: FixedShortcutGroup[];
}) {
  const [recording, setRecording] = useState(false);
  const combo = shortcuts[action];
  /** The fixed shortcut that has `next` already, by its label. */
  const fixedOwner = (next: string) =>
    fixed
      .flatMap((group) => group.items)
      .find((item) => item.combos.includes(next))?.label;
  // A key bound before it was checked (or before it became fixed).
  const taken = combo ? fixedOwner(combo) : undefined;
  /** The combo a new installation has here, which Reset puts back. */
  const fallback = defaultShortcuts()[action];
  const [error, setError] = useState("");
  const actionLabels = useMemo<Record<ShortcutAction, string>>(
    () => ({
      triggerCompletion: t.shortcutTriggerCompletion,
      triggerGrammarCheck: t.shortcutTriggerGrammarCheck,
      toggleFloatingChat: t.shortcutToggleFloatingChat,
      toggleTextusAi: t.shortcutToggleTextusAi,
      findReplace: t.shortcutFindReplace,
      toggleSidebar: t.shortcutToggleSidebar,
      toggleAgentPanel: t.shortcutToggleAgentPanel,
      toggleSplitView: t.shortcutToggleSplitView,
      toggleZenMode: t.shortcutToggleZenMode,
      splitEditor: t.shortcutSplitEditor,
      commandPalette: t.shortcutCommandPalette,
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
      // Named where a fixed shortcut owns the key, as for another action.
      const owner = fixedOwner(captured);
      if (owner) {
        setError(t.shortcutConflict.replace("{action}", owner));
        return;
      }
      if (isReservedCombo(captured)) {
        setError(t.shortcutReserved);
        return;
      }
      if (bind(captured)) setRecording(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  /** Gives this action `next`, unless another action has it already.
   *  Whether it did. */
  function bind(next: string): boolean {
    const conflict = (Object.keys(shortcuts) as ShortcutAction[]).find(
      (other) => other !== action && shortcuts[other] === next,
    );
    if (conflict) {
      setError(t.shortcutConflict.replace("{action}", actionLabels[conflict]));
      return false;
    }

    setError("");
    setSettings({ shortcuts: { ...shortcuts, [action]: next } });
    return true;
  }

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
          {fallback && combo !== fallback && !recording && (
            <button
              className="text-button settings-inline-button"
              aria-label={`${t.shortcutReset}: ${label}`}
              title={formatCombo(fallback)}
              onClick={() => bind(fallback)}
            >
              {t.shortcutReset}
            </button>
          )}
        </div>
      </div>
      {(error || taken) && (
        <div className="settings-error" role="alert">
          {error || t.shortcutConflict.replace("{action}", taken!)}
        </div>
      )}
    </div>
  );
}
