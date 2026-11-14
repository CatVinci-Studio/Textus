import { tabElement } from "../engine/layout/tab-element";
import { tabInUse } from "../engine/layout/store";
import { useEffect, useRef, useState } from "react";
import type { Strings } from "../i18n/strings";
import { caretBlock, NO_BLOCK, type CaretBlock } from "../editor/caret-block";
import { IconButton } from "../engine/controls/IconButton";
import { useFitItems } from "../engine/controls/fit-steps";
import { useMenuButton } from "../engine/controls/useMenuButton";
import { usePhoneLayout } from "../engine/controls/usePhoneLayout";
import type {
  ContextMenuEntry,
  ContextMenuItem,
} from "../engine/controls/ContextMenu";
import { fill } from "../i18n/fill";
import { HideKeyboardIcon, MoreIcon } from "../engine/controls/icons";
import { formatCombo } from "../utils/shortcuts";
import { EDITOR_MORE_EVENT, INSERT_BLOCK_EVENT } from "../utils/events";
import { GROUPS, type Button } from "./format-buttons";
import { phoneGroups } from "./format-bar-phone";
import "./format-bar.css";

/**
 * The format bar (View › Format Bar): a row under the title bar with what the
 * Format menu does, for Markdown's own formats only. It sends the menu's
 * events, so the document on screen answers as it does to the menu, and
 * lights what is on at the caret.
 */
/** Every button, in the row's order: the ones folded into "⋯" go by it. */
const ALL: Button[] = GROUPS.flat();

/** The buttons `row` has folded away. */
function folded(row: HTMLElement | null): Button[] {
  if (!row) return [];
  return [
    ...row.querySelectorAll<HTMLElement>("[data-fit-hidden][data-fit-item]"),
  ].map((el) => ALL[Number(el.dataset.fitItem)]);
}

/** A button's press: its document first, then the menu's event. */
function press(tabId: string, b: Button) {
  focusDocument(tabId);
  window.dispatchEvent(new CustomEvent(b.event, { detail: b.detail }));
}

/** The heading picker: body text or a level, as Format's items set them,
 *  the caret's own ticked. */
function headingItems(
  t: Strings,
  tabId: string,
  level: number,
): ("separator" | ContextMenuItem)[] {
  const pick = (detail: string) => () => {
    focusDocument(tabId);
    window.dispatchEvent(new CustomEvent(INSERT_BLOCK_EVENT, { detail }));
  };
  return [
    {
      label: t.shortcutParagraph,
      checked: level === 0,
      onSelect: pick("paragraph"),
    },
    "separator",
    ...[1, 2, 3, 4, 5, 6].map((n) => ({
      label: fill(t.menuHeadingTemplate, { n: String(n) }),
      checked: level === n,
      onSelect: pick(`h${n}`),
    })),
  ];
}

/** What is on at the caret of one document, kept current: nothing while
 *  the caret is in another. */
function useCaretBlock(tabId: string): CaretBlock {
  const [block, setBlock] = useState<CaretBlock>(NO_BLOCK);
  useEffect(() => {
    let frame = 0;
    // The DOM settles after ProseMirror's update; read it a frame later.
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setBlock(caretBlock(tabInUse() === tabId ? tabElement(tabId) : null)),
      );
    };
    read();
    document.addEventListener("selectionchange", read);
    document.addEventListener("input", read);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", read);
      document.removeEventListener("input", read);
    };
  }, [tabId]);
  return block;
}

/** Another island's bar: its document takes the keys first, at the
 *  selection it kept, so the format lands there. */
function focusDocument(tabId: string) {
  const editor = tabElement(tabId)?.querySelector<HTMLElement>(".ProseMirror");
  if (editor && !editor.contains(document.activeElement)) editor.focus();
}

export function FormatBar({
  t,
  tabId,
}: {
  t: Strings;
  /** The document it formats: a press brings it into use first (its
   *  island's pointerdown), so the menu's events reach it. */
  tabId: string;
}) {
  const block = useCaretBlock(tabId);
  const phone = usePhoneLayout();
  // A phone's follows the caret into a table or onto an image, and scrolls
  // rather than folding: its "⋯" is the editor's menu (PhoneEnd).
  const groups = phone ? phoneGroups(block) : GROUPS;
  // Narrower than its buttons, it keeps as many as fit and folds the rest,
  // from the end, into "⋯".
  const row = useRef<HTMLDivElement>(null);
  useFitItems(row, ".format-bar-more");
  const headings = () => headingItems(t, tabId, block.heading);
  const heading = useMenuButton(headings, { title: t.toolbarHeading });
  const more = useMenuButton(
    () =>
      folded(row.current).map((b): ContextMenuEntry =>
        b.picksHeading
          ? { label: b.label(t), items: headings() }
          : { label: b.label(t), onSelect: () => press(tabId, b) },
      ),
    { alignEnd: true },
  );
  return (
    <div
      className="format-bar"
      role="toolbar"
      aria-label={t.toolbarLabel}
      // A press leaves the caret where it was, in the document.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div ref={row} className="format-bar-row">
        {groups.map((group, g) => (
          <div key={g} className="format-bar-group">
            {group.map((b) => {
              const label = b.label(t);
              return (
                <span
                  key={label}
                  className="format-bar-item"
                  data-fit-item={phone ? undefined : ALL.indexOf(b)}
                >
                  <IconButton
                    label={label}
                    hint={b.keys ? `${label}  ${formatCombo(b.keys)}` : label}
                    // A menu's button says it opens one, not that it is on.
                    pressed={b.on && !b.picksHeading ? b.on(block) : undefined}
                    onClick={b.picksHeading ? undefined : () => press(tabId, b)}
                    opens={b.picksHeading ? heading.button : undefined}
                  >
                    {b.Icon ? <b.Icon /> : b.text?.(t)}
                  </IconButton>
                </span>
              );
            })}
          </div>
        ))}
        {!phone && (
          <IconButton
            label={t.toolbarMore}
            className="tx-icon-button format-bar-more"
            opens={more.button}
          >
            <MoreIcon />
          </IconButton>
        )}
      </div>
      {phone && <PhoneEnd t={t} />}
      {heading.menu}
      {more.menu}
    </div>
  );
}

/** The phone's strip, shown only while typing, ends with the editor's
 *  menu for where the caret is (it has no right-click) and a key that puts
 *  the keyboard away. */
function PhoneEnd({ t }: { t: Strings }) {
  return (
    <>
      <IconButton
        label={t.toolbarMore}
        onClick={() => window.dispatchEvent(new CustomEvent(EDITOR_MORE_EVENT))}
      >
        <MoreIcon />
      </IconButton>
      <IconButton
        label={t.toolbarHideKeyboard}
        onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
      >
        <HideKeyboardIcon />
      </IconButton>
    </>
  );
}
