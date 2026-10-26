import { useEffect, useRef } from "react";
import type { Lang, Strings } from "../../i18n/strings";
import { tapKeepingFocus } from "../../ui/tap";
import type { PickerGroupId } from "./skill-picker";

/** The pickers' words, in the UI language (chat-labels.ts). */
export interface PickerLabels {
  /** The UI language: picks the built-in skills' labels. */
  lang: Lang;
  groups: Record<PickerGroupId, string>;
  /** "↑↓ to move · Enter to choose · Esc to close" - not on a phone. */
  keys: string;
  skillAbout: string;
  /** Says `{query}`. */
  skillNoMatch: string;
  skillHowTo: string;
  mentionAbout: string;
  mentionNoProject: string;
  mentionNoFiles: string;
  /** Says `{query}`. */
  mentionNoMatch: string;
}

export function pickerLabels(t: Strings, lang: Lang): PickerLabels {
  return {
    lang,
    groups: {
      recent: t.skillGroupRecent,
      project: t.skillGroupProject,
      global: t.skillGroupYours,
      write: t.skillCategoryWrite,
      revise: t.skillCategoryRevise,
      check: t.skillCategoryCheck,
      format: t.skillCategoryFormat,
      create: t.skillCategoryCreate,
    },
    keys: t.pickerKeysHint,
    skillAbout: t.skillPickerAbout,
    skillNoMatch: t.skillPickerNoMatch,
    skillHowTo: t.skillPickerHowTo,
    mentionAbout: t.mentionPickerAbout,
    mentionNoProject: t.mentionPickerNoProject,
    mentionNoFiles: t.mentionPickerNoFiles,
    mentionNoMatch: t.mentionPickerNoMatch,
  };
}

/** One row: a skill (label, /name, hint) or a file (name, folder). */
export interface PickerRow {
  key: string;
  primary: string;
  /** Beside the primary text, quieter: a built-in's `/name`. */
  secondary?: string;
  /** The line under it: what a skill does, where a file is. */
  detail?: string;
  pick: () => void;
}

export interface PickerSection {
  title?: string;
  rows: PickerRow[];
}

/**
 * The menu above the composer that `/` and `@` open. It always says
 * something: the matches, grouped, with the keys that drive it - or, with
 * nothing to list, what the key is for and how to get something to list.
 * (It used to render only when something matched, so a first `/` or an `@`
 * in an unsaved document looked like a dead key.)
 */
export function ComposerPicker({
  kind,
  label,
  sections,
  empty,
  active,
  keys,
}: {
  kind: "skill" | "mention";
  /** The listbox's accessible name. */
  label: string;
  sections: PickerSection[];
  /** Lines shown when there are no rows. */
  empty: string[];
  /** Index of the highlighted row, across all sections. */
  active: number;
  /** The keyboard hint, or null (a phone has no arrow keys). */
  keys: string | null;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const count = sections.reduce((n, s) => n + s.rows.length, 0);

  // The highlighted row stays in view by scrolling the menu alone (as
  // ui/Select does): scrollIntoView would move the panel around it too.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(
      `[data-picker-index="${active}"]`,
    );
    if (!list || !item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (
      item.offsetTop + item.offsetHeight >
      list.scrollTop + list.clientHeight
    )
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  }, [active, count]);

  let index = 0;
  return (
    <div className="inline-chat-skill-menu composer-picker" data-picker={kind}>
      {count === 0 ? (
        <div className="composer-picker-empty" role="status">
          {empty.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      ) : (
        <div
          className="composer-picker-list"
          role="listbox"
          aria-label={label}
          ref={listRef}
        >
          {sections.map((section, s) => (
            <div
              key={section.title ?? `section-${s}`}
              role="group"
              aria-label={section.title}
              className="composer-picker-group"
            >
              {section.title && (
                <div className="composer-picker-group-title" aria-hidden="true">
                  {section.title}
                </div>
              )}
              {section.rows.map((row) => {
                const i = index++;
                return (
                  <button
                    key={row.key}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    data-picker-index={i}
                    className={`inline-chat-skill-item composer-picker-item${i === active ? " inline-chat-skill-item-active" : ""}`}
                    // On press, not click: keeps focus (and on a phone the
                    // keyboard) in the textarea.
                    {...tapKeepingFocus(row.pick)}
                  >
                    <span className="composer-picker-line">
                      <span className="inline-chat-skill-name">
                        {row.primary}
                      </span>
                      {row.secondary && (
                        <span className="composer-picker-secondary">
                          {row.secondary}
                        </span>
                      )}
                    </span>
                    {row.detail && (
                      <span className="inline-chat-skill-preview">
                        {row.detail}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {keys && count > 0 && (
        <div className="composer-picker-keys" aria-hidden="true">
          {keys}
        </div>
      )}
    </div>
  );
}
