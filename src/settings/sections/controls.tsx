import { useEffect, useId, useRef, type ReactNode } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import { resolveStrings, type Strings } from "../../i18n/strings";
import { ChevronIcon } from "../../ui/icons";
import { InfoTip } from "../../ui/InfoTip";

/** For a field that takes a machine-read value rather than prose: iOS would
 *  capitalise and autocorrect it into an id the provider rejects. */
export const VERBATIM_INPUT = {
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false,
} as const;

/**
 * One setting: its name on the left, its control on the right. `help` is the
 * explanation a label can't carry, behind a "?"; `hint` is something live
 * under the label, a value or a status.
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

/** A row's "?", named after the row: "More about …". */
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

/** A switch row; the whole row toggles it. The switch is named by the label
 *  alone, since the "?" sits inside the <label>. */
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

/** How a key reads in its field: its first six and last four characters
 *  around ***; a short one, still being typed, as dots. */
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
 * A key's field, showing it masked. A password field would show a row of
 * dots and offer to save it. The field holds the mask, so every edit is
 * taken before the browser makes it.
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
