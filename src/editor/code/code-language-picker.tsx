import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { isIOSApp } from "../../platform/capabilities";
import { Select } from "../../ui/Select";
import { usePresence, useMergedRef } from "../../ui/usePresence";
import { useFloatingList } from "../../ui/useFloatingList";

/** What the picker shows and does; given again whenever it changes. */
export interface LanguagePickerProps {
  /** The fence's language, "" for none. */
  value: string;
  /** The menu's languages, "" first for plain text. */
  languages: readonly string[];
  label: string;
  searchLabel: string;
  onChange: (language: string) => void;
  /** The menu opened or closed: the block keeps its header shown. */
  onOpenChange: (open: boolean) => void;
}

const optionLabel = (lang: string) => (lang === "" ? "plain text" : lang);

/** The languages matching `query`; one typed that the menu lacks is
 *  offered as it is, so any fence can be named. */
export function matchLanguages(
  languages: readonly string[],
  query: string,
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...languages];
  const found = languages.filter((lang) =>
    optionLabel(lang).toLowerCase().includes(q),
  );
  // Those starting with what was typed first: "sc" finds scss before css.
  const starts = (lang: string) => optionLabel(lang).startsWith(q);
  found.sort((a, b) => Number(starts(b)) - Number(starts(a)));
  return found.includes(q) || /\s/.test(q) ? found : [...found, q];
}

/**
 * A code block's language picker inside the block's view
 * (code-block-language-view.ts), which is plain DOM: the app's menu with a
 * search field on top, as the list is long. On iPhone and iPad the
 * system's picker (Select), sized for a finger.
 */
export function mountLanguagePicker(container: HTMLElement) {
  let root: Root | null = createRoot(container);
  return {
    render(props: LanguagePickerProps) {
      // A fence's own spelling (`js`, `sh`, `mermaid`) outside the list
      // gets an option of its own: shown as plain text, the block would
      // be mislabelled, and picking from the menu rewrote its fence.
      const languages = props.languages.includes(props.value)
        ? props.languages
        : [...props.languages, props.value];
      root?.render(
        isIOSApp ? (
          <Select
            className="code-block-language-select"
            aria-label={props.label}
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
          >
            {languages.map((lang) => (
              <option key={lang} value={lang}>
                {optionLabel(lang)}
              </option>
            ))}
          </Select>
        ) : (
          <LanguageMenu {...props} languages={languages} />
        ),
      );
    },
    destroy() {
      const done = root;
      root = null;
      // Not while ProseMirror is redrawing, which may be inside a React
      // render of its own.
      queueMicrotask(() => done?.unmount());
    },
  };
}

/** A list beside its trigger (useFloatingList) that shrinks back into it
 *  as it closes, as Select's does. */
function useFloatingMenu(open: boolean, active: number, dismiss: () => void) {
  const floating = useFloatingList(open, active, dismiss);
  const presence = usePresence(open, { exitMs: 120 });
  const listRef = useMergedRef(floating.listRef, presence.ref);
  return { ...floating, listRef, presence };
}

function LanguageMenu({
  value,
  languages,
  label,
  searchLabel,
  onChange,
  onOpenChange,
}: LanguagePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { triggerRef, listRef, place, presence } = useFloatingMenu(
    open,
    active,
    () => show(false),
  );
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const shown = matchLanguages(languages, query);

  // After the list takes the focus as it opens: typing goes to the search.
  useEffect(() => {
    if (open) search.current?.focus({ preventScroll: true });
  }, [open]);

  function show(next: boolean) {
    setOpen(next);
    onOpenChange(next);
    if (!next) return;
    setQuery("");
    setActive(Math.max(0, languages.indexOf(value)));
  }

  function choose(lang: string | undefined) {
    if (lang === undefined) return;
    show(false);
    if (lang !== value) onChange(lang);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + shown.length) % Math.max(1, shown.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      show(false);
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      show(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ui-select code-block-language-select"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        onClick={() => show(!open)}
      >
        <span className="ui-select-value">{optionLabel(value)}</span>
      </button>
      {presence.mounted &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            data-state={presence.state}
            inert={presence.state === "closing" || undefined}
            className="ui-select-menu floating-surface code-language-menu"
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            style={place}
            data-floating-select=""
          >
            <li role="presentation" className="code-language-search">
              <input
                ref={search}
                type="text"
                value={query}
                placeholder={searchLabel}
                aria-label={searchLabel}
                aria-activedescendant={
                  shown.length ? `${listId}-${active}` : undefined
                }
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKey}
              />
            </li>
            {shown.map((lang, index) => (
              <li
                key={lang}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={lang === value}
                className={`ui-select-option${index === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(lang)}
              >
                {optionLabel(lang)}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
