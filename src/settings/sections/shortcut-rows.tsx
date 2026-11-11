import { fill } from "../../i18n/fill";
import { useEffect, useState } from "react";
import {
  defaultShortcuts,
  type ShortcutAction,
  type Shortcuts,
} from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import type { FixedShortcutGroup } from "../../registry/fixed-shortcuts";
import {
  comboFromEvent,
  isBindableCombo,
  formatCombo,
  isReservedCombo,
} from "../../utils/shortcuts";
import { isImeKeydown } from "../../utils/ime";
import { modIsMeta } from "../../platform/os";
import { keyOwner } from "../../prefs/key-owner";

// Settings › Shortcuts' rows: one that records a key combination, for the
// app's own actions and for the commands plugins add.

/** The shortcuts that can't be changed, read-only, by menu. */
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
  fixed?: FixedShortcutGroup[];
}) {
  return (
    <ShortcutRecorder
      label={label}
      combo={shortcuts[action]}
      fallback={defaultShortcuts()[action]}
      ownerOf={(next) =>
        keyOwner(next, { t, fixed, shortcuts, mac: modIsMeta(), self: action })
      }
      onChange={(next) =>
        setSettings({ shortcuts: { ...shortcuts, [action]: next } })
      }
      t={t}
    />
  );
}

/** A plugin command's shortcut: the user's own over the manifest's, by
 *  command id ("" for none). A key an app action has stays the app's. */
export function CommandShortcutRow({
  label,
  command,
  fallback,
  overrides,
  setOverrides,
  others,
  shortcuts,
  t,
  fixed = [],
}: {
  label: string;
  command: string;
  fallback?: string;
  overrides: Record<string, string>;
  setOverrides: (next: Record<string, string>) => void;
  /** The other commands' shortcuts now, with their names. */
  others: { label: string; combo: string }[];
  shortcuts: Shortcuts;
  t: Strings;
  fixed?: FixedShortcutGroup[];
}) {
  return (
    <ShortcutRecorder
      label={label}
      combo={overrides[command] ?? fallback ?? ""}
      fallback={fallback}
      ownerOf={(next) =>
        keyOwner(next, { t, fixed, shortcuts, mac: modIsMeta(), others })
      }
      onChange={(next) => {
        const rest = { ...overrides };
        delete rest[command];
        setOverrides(next === fallback ? rest : { ...rest, [command]: next });
      }}
      t={t}
    />
  );
}

/** A shortcut's row: its keys recorded by pressing them (Esc gives up),
 *  cleared, or reset. A combo someone else owns is refused, and named. */
function ShortcutRecorder({
  label,
  combo,
  fallback,
  ownerOf,
  onChange,
  t,
}: {
  label: string;
  combo: string;
  /** What a new installation has here, which Reset puts back. */
  fallback?: string;
  ownerOf: (combo: string) => string | undefined;
  onChange: (combo: string) => void;
  t: Strings;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  // A key bound before it was checked (or before its owner took it).
  const taken = combo ? ownerOf(combo) : undefined;

  /** Gives this row `next`, unless someone else has it. Whether it did. */
  function bind(next: string): boolean {
    const owner = ownerOf(next);
    if (owner) {
      setError(fill(t.shortcutConflict, { action: owner }));
      return false;
    }
    setError("");
    onChange(next);
    return true;
  }

  useEffect(() => {
    if (!recording) return;
    function onKeyDown(e: KeyboardEvent) {
      if (isImeKeydown(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const captured = comboFromEvent(e);
      if (!captured || !isBindableCombo(captured)) return;
      // Named where another owns the key, before the reserved ones.
      const owner = ownerOf(captured);
      if (owner) {
        setError(fill(t.shortcutConflict, { action: owner }));
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

  return (
    <div className="shortcut-setting">
      <div className="settings-row">
        <span className="settings-row-label">{label}</span>
        <div className="shortcut-row-controls">
          {/* The key last, so every row's lines up at the end; what acts
              on it before it. */}

          {combo && !recording && (
            <button
              className="text-button settings-inline-button shortcut-clear"
              aria-label={`${t.shortcutClear}: ${label}`}
              onClick={() => {
                setError("");
                onChange("");
              }}
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
        </div>
      </div>
      {(error || taken) && (
        <div className="settings-error" role="alert">
          {error || fill(t.shortcutConflict, { action: taken! })}
        </div>
      )}
    </div>
  );
}
