import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Lang } from "../../i18n/strings";
import { isIOSApp } from "../../platform/capabilities";
import { Select } from "../../ui/Select";
import { useFloatingMenu } from "../../ui/useFloatingMenu";
import { isImeKeydown } from "../../utils/ime";
import {
  fontFamilies,
  fontLabel,
  matchFonts,
  recentFonts,
  recentGroup,
  rememberFont,
  type FontFamily,
} from "./font-families";
import "./FontPicker.css";

export interface FontPickerLabels {
  label: string;
  /** The theme's own font: the first choice. */
  auto: string;
  search: string;
  recent: string;
  all: string;
  none: string;
}

/** Every row is this tall (FontPicker.css), so only those in view are drawn:
 *  each name is set in its own font, and drawing a few hundred loads them. */
const ROW = 32;
const MENU_HEIGHT = 360;
/** Rows drawn beyond the view, so an arrow key's next row is there. */
const OVERSCAN = 4;

type Row =
  | { kind: "auto" }
  | { kind: "heading"; text: string }
  | { kind: "font"; family: FontFamily };

/** The face a name is shown in: its own, the UI's where it lacks a glyph. */
const faceOf = (name: string) => `${JSON.stringify(name)}, var(--font-sans)`;

/** The document's text font: the theme's, or one of the installed families,
 *  found by any of its names and shown in its own face. */
export function FontPicker({
  value,
  onChange,
  lang,
  labels,
}: {
  value: string;
  onChange: (font: string) => void;
  lang: Lang;
  labels: FontPickerLabels;
}) {
  const [fonts, setFonts] = useState<FontFamily[]>([]);
  useEffect(() => {
    let live = true;
    void fontFamilies().then((list) => live && setFonts(list));
    return () => {
      live = false;
    };
  }, []);
  const choose = (font: string) => {
    if (font) rememberFont(font);
    if (font !== value) onChange(font);
  };
  if (isIOSApp)
    return (
      <Select
        className="settings-select"
        aria-label={labels.label}
        value={value}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="">{labels.auto}</option>
        {[...recentGroup(fonts, [], value), ...fonts].map((family) => (
          <option key={family.name} value={family.name}>
            {fontLabel(family, lang)}
          </option>
        ))}
      </Select>
    );
  return (
    <FontMenu
      value={value}
      fonts={fonts}
      lang={lang}
      labels={labels}
      onChoose={choose}
    />
  );
}

function FontMenu({
  value,
  fonts,
  lang,
  labels,
  onChoose,
}: {
  value: string;
  fonts: FontFamily[];
  lang: Lang;
  labels: FontPickerLabels;
  onChoose: (font: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const menu = useFloatingMenu(open, active, () => setOpen(false), MENU_HEIGHT);
  // Where the list starts scrolled to as it opens: at the chosen font.
  const startAt = useRef(0);
  const listId = useId();

  const rows = menu.presence.mounted
    ? menuRows(fonts, query, value, lang, labels)
    : [];

  // After the list took the focus (useFloatingList's effect, before this
  // one): typing goes to the search, and the chosen font is in view.
  useEffect(() => {
    if (!open) return;
    const list = menu.list.current;
    list?.querySelector("input")?.focus({ preventScroll: true });
    if (list) list.scrollTop = startAt.current;
  }, [open, menu.list]);

  function show(next: boolean) {
    setOpen(next);
    if (!next) return;
    setQuery("");
    const chosen = Math.max(
      0,
      menuRows(fonts, "", value, lang, labels).findIndex((row) =>
        isValue(row, value),
      ),
    );
    setActive(chosen);
    startAt.current = Math.max(0, (chosen - 3) * ROW);
    setScrollTop(startAt.current);
  }

  function close() {
    setOpen(false);
    menu.triggerRef.current?.focus();
  }

  function choose(row: Row | undefined) {
    if (!row || row.kind === "heading") return;
    close();
    onChoose(row.kind === "auto" ? "" : row.family.name);
  }

  // The next row that can be chosen, past the group headings.
  const step = (from: number, by: 1 | -1) => {
    for (let i = from + by; i >= 0 && i < rows.length; i += by)
      if (rows[i].kind !== "heading") return i;
    return from;
  };

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (isImeKeydown(e)) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => step(i, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(rows[active]);
    } else if (e.key === "Escape") {
      // Closes the list, not the Settings it sits in.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  // The rows in view and a few either side; the rest are empty space.
  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(
    rows.length,
    first + Math.ceil(MENU_HEIGHT / ROW) + 2 * OVERSCAN,
  );
  const current = fonts.find((family) => family.name === value);
  return (
    <>
      <button
        ref={menu.triggerRef}
        type="button"
        className="ui-select settings-select"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={labels.label}
        onClick={() => (open ? close() : show(true))}
      >
        <span
          className="ui-select-value"
          style={value ? { fontFamily: faceOf(value) } : undefined}
        >
          {value
            ? fontLabel(current ?? { name: value, local: {} }, lang)
            : labels.auto}
        </span>
      </button>
      {menu.presence.mounted &&
        createPortal(
          <ul
            ref={menu.listRef}
            id={listId}
            data-state={menu.presence.state}
            inert={menu.presence.state === "closing" || undefined}
            className="ui-select-menu floating-surface font-picker-menu"
            role="listbox"
            aria-label={labels.label}
            tabIndex={-1}
            style={menu.place}
            data-floating-select=""
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            <li
              role="presentation"
              className="font-picker-search"
              data-pinned=""
            >
              <input
                type="text"
                value={query}
                placeholder={labels.search}
                aria-label={labels.search}
                aria-activedescendant={
                  rows[active] ? `${listId}-${active}` : undefined
                }
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                  setScrollTop(0);
                  if (menu.list.current) menu.list.current.scrollTop = 0;
                }}
                onKeyDown={onKey}
              />
            </li>
            {rows.length === 0 && (
              <li role="presentation" className="font-picker-empty">
                {labels.none}
              </li>
            )}
            <li role="presentation" style={{ height: first * ROW }} />
            {rows.slice(first, last).map((row, offset) => (
              <FontRow
                key={first + offset}
                row={row}
                index={first + offset}
                id={`${listId}-${first + offset}`}
                value={value}
                active={first + offset === active}
                lang={lang}
                labels={labels}
                onHover={setActive}
                onChoose={choose}
              />
            ))}
            <li
              role="presentation"
              style={{ height: (rows.length - last) * ROW }}
            />
          </ul>,
          document.body,
        )}
    </>
  );
}

/** One row: a group's heading, or a font's name in its own face with its
 *  CSS name after it when that is another. */
function FontRow({
  row,
  index,
  id,
  value,
  active,
  lang,
  labels,
  onHover,
  onChoose,
}: {
  row: Row;
  index: number;
  id: string;
  value: string;
  active: boolean;
  lang: Lang;
  labels: FontPickerLabels;
  onHover: (index: number) => void;
  onChoose: (row: Row) => void;
}) {
  if (row.kind === "heading")
    return (
      <li role="presentation" className="font-picker-heading">
        {row.text}
      </li>
    );
  const name = row.kind === "auto" ? "" : row.family.name;
  const shown = row.kind === "auto" ? labels.auto : fontLabel(row.family, lang);
  return (
    <li
      id={id}
      data-index={index}
      role="option"
      aria-selected={name === value}
      className={`ui-select-option font-picker-option${active ? " is-active" : ""}`}
      onMouseEnter={() => onHover(index)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onChoose(row)}
    >
      <span
        className="font-picker-face"
        style={name ? { fontFamily: faceOf(name) } : undefined}
      >
        {shown}
      </span>
      {name && shown !== name && (
        <span className="font-picker-name">{name}</span>
      )}
    </li>
  );
}

function isValue(row: Row, value: string): boolean {
  return row.kind === "auto"
    ? value === ""
    : row.kind === "font" && row.family.name === value;
}

/** The rows: the theme's font, the recent group, then every font; or,
 *  searching, the fonts found. */
function menuRows(
  fonts: FontFamily[],
  query: string,
  value: string,
  lang: Lang,
  labels: FontPickerLabels,
): Row[] {
  if (query.trim())
    return matchFonts(fonts, query, lang).map((family) => ({
      kind: "font",
      family,
    }));
  const recent = recentGroup(fonts, recentFonts(), value);
  return [
    { kind: "auto" },
    ...(recent.length
      ? [
          { kind: "heading", text: labels.recent } as Row,
          ...recent.map((family): Row => ({ kind: "font", family })),
        ]
      : []),
    ...(fonts.length ? [{ kind: "heading", text: labels.all } as Row] : []),
    ...fonts.map((family): Row => ({ kind: "font", family })),
  ];
}
