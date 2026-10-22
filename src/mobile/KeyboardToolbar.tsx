import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { useSettings } from "../settings/SettingsContext";
import { aiFeatures } from "../settings/textus-ai";
import type { TableAction } from "../editor/editor-menu";
import {
  BulletListIcon,
  MoreIcon,
  NumberedListIcon,
  TableEditIcon,
  TrashIcon,
  UndoIcon,
} from "../ui/icons";
import {
  EDIT_ACTION_EVENT,
  EDITOR_MORE_EVENT,
  IMAGE_ACTION_EVENT,
  INSERT_BLOCK_EVENT,
  TABLE_ACTION_EVENT,
  TOGGLE_BLOCK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  TOGGLE_MARK_EVENT,
} from "../utils/events";
import { pressKeepingFocus } from "../ui/tap";
import "./KeyboardToolbar.css";

/**
 * The strip above the iPhone keyboard while the document is being edited:
 * undo (copy and paste are the system's own long-press menu, used too
 * rarely to keep two buttons here); then whatever fits where the caret is - formatting
 * without typing Markdown symbols in text, adding and deleting rows and
 * columns in a table, widths and delete on a tapped image; "More" for the
 * rest of the editor's right-click menu; and Quick Ask at the caret. A
 * phone has no right-click (a long press brings up the system's text
 * menu, not Textus's) and no hover, so this strip is how a finger reaches
 * what the desktop keeps in menus and hover controls.
 *
 * The buttons keep the editor's focus, so the keyboard stays up and the
 * caret where it was: a tap runs the button on touchend and cancels the
 * default there, which is what would move focus to the button (and the
 * click that would follow); a swipe along the row presses nothing
 * (pressKeepingFocus in tap.ts). They reach the editor the
 * way the menus do, through window events (utils/events.ts).
 */
const send = (event: string, detail?: string) =>
  window.dispatchEvent(new CustomEvent(event, { detail }));

/** What the caret sits in, read off the editor's DOM: the heading level
 *  the H button shows, which block buttons are on, and whether the table
 *  or image buttons take the place of the formatting ones. */
interface CaretBlock {
  heading: number;
  bulletList: boolean;
  orderedList: boolean;
  quote: boolean;
  table: boolean;
  /** A tapped (node-selected) image, and its CSS width ("50%", "320px") -
   *  null for auto. */
  image: { width: string | null } | null;
}
const NO_BLOCK: CaretBlock = {
  heading: 0,
  bulletList: false,
  orderedList: false,
  quote: false,
  table: false,
  image: null,
};

function caretBlock(): CaretBlock {
  const editor = document.activeElement?.closest(".milkdown .ProseMirror");
  // ProseMirror marks the node view of a node selection (image-plugin.ts),
  // where the DOM selection only brackets it.
  const image = editor?.querySelector<HTMLElement>(
    ".image-view.ProseMirror-selectednode",
  );
  if (image) {
    // The view sets its width from the image's (image-plugin.ts).
    return { ...NO_BLOCK, image: { width: image.style.width || null } };
  }
  const node = document.getSelection()?.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el?.closest(".milkdown .ProseMirror")) return NO_BLOCK;
  const heading = el.closest("h1, h2, h3, h4, h5, h6");
  const list = el.closest("ul, ol");
  return {
    heading: heading ? Number(heading.tagName.slice(1)) : 0,
    bulletList: list?.tagName === "UL",
    orderedList: list?.tagName === "OL",
    quote: !!el.closest("blockquote"),
    table: !!el.closest("table"),
    image: null,
  };
}

const IMAGE_WIDTHS = [30, 50, 70, 100] as const;

/**
 * An iPad with the AI panel docked beside the text: the strip spans the
 * text's column, not the screen - full width it covered the panel's
 * composer (mode picker, +, search and Send). The phone's AI sheet
 * (position: fixed) covers the strip itself, so it is not measured.
 */
function usePanelInset(editing: boolean): number {
  const [panelInset, setPanelInset] = useState(0);
  useLayoutEffect(() => {
    if (!editing) return;
    let observed: HTMLElement | null = null;
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => measure());
    function measure() {
      const panel = document.querySelector<HTMLElement>(
        '.agent-panel:not([data-state="closing"])',
      );
      if (panel !== observed) {
        if (observed) resize?.unobserve(observed);
        if (panel) resize?.observe(panel);
        observed = panel;
      }
      const docked = !!panel && getComputedStyle(panel).position !== "fixed";
      // Its laid-out width, not where it shows: it may still be sliding
      // in from beside the screen. It always stands at the right edge.
      setPanelInset(docked ? panel.offsetWidth : 0);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      resize?.disconnect();
    };
  }, [editing]);
  return panelInset;
}

export function KeyboardToolbar() {
  const { t, settings } = useSettings();
  const [editing, setEditing] = useState(false);
  const [block, setBlock] = useState<CaretBlock>(NO_BLOCK);
  // The DOM settles after ProseMirror's update; read it a frame later.
  const update = useCallback(
    () => requestAnimationFrame(() => setBlock(caretBlock())),
    [],
  );

  useEffect(() => {
    if (!editing) return;
    update();
    document.addEventListener("selectionchange", update);
    document.addEventListener("input", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("input", update);
    };
  }, [editing, update]);

  // Up while a document editor has focus - which on a phone is exactly
  // while its keyboard is up.
  useEffect(() => {
    // Quick Ask's composer sits inside the editor's DOM (a widget at the
    // caret), but typing there is not editing the document.
    const inEditor = (node: EventTarget | null) =>
      node instanceof Element &&
      !!node.closest(".milkdown .ProseMirror") &&
      !node.closest(".inline-chat");
    const onIn = (e: FocusEvent) => setEditing(inEditor(e.target));
    const onOut = (e: FocusEvent) => {
      if (!inEditor(e.relatedTarget)) setEditing(false);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("has-keyboard-toolbar", editing);
  }, [editing]);

  const panelInset = usePanelInset(editing);

  if (!editing) return null;

  type Button = {
    label: string;
    content: ReactNode;
    className?: string;
    /** A toggle that is on where the caret is. */
    on?: boolean;
    run: () => void;
  };
  const toggle = (kind: string) => () => send(TOGGLE_BLOCK_EVENT, kind);
  const edit = (action: string) => () => send(EDIT_ACTION_EVENT, action);
  const table = (action: TableAction, label: string, danger?: boolean) => ({
    label,
    content: <TableEditIcon kind={action} />,
    className: danger ? "kbt-danger" : undefined,
    run: () => send(TABLE_ACTION_EVENT, action),
  });
  const image = (action: string) => () => send(IMAGE_ACTION_EVENT, action);

  const editGroup: Button[] = [
    { label: t.menuUndo, content: <UndoIcon />, run: edit("undo") },
  ];

  // In a table or on an image, the buttons for it stand where the text
  // formatting is: Markdown has no headings or lists inside a table cell,
  // and none apply to an image. The table's own "+" strips are hover
  // controls, hidden on a phone (mobile/styles/editor.css).
  let contextGroups: Button[][];
  if (block.image) {
    const width = block.image.width;
    contextGroups = [
      [
        {
          label: t.imageWidthAuto,
          content: t.imageWidthShortAuto,
          className: "kbt-text",
          on: width === null,
          run: image("width:auto"),
        },
        ...IMAGE_WIDTHS.map((percent) => ({
          label: t[`imageWidth${percent}` as const],
          content: `${percent}%`,
          className: "kbt-text",
          on: width === `${percent}%`,
          run: image(`width:${percent}`),
        })),
      ],
      [
        {
          label: t.deleteImage,
          content: <TrashIcon />,
          className: "kbt-danger",
          run: image("delete"),
        },
      ],
    ];
  } else if (block.table) {
    contextGroups = [
      [
        table("row-below", t.insertRowBelow),
        table("row-above", t.insertRowAbove),
        table("column-right", t.insertColumnRight),
        table("column-left", t.insertColumnLeft),
      ],
      [
        table("delete-row", t.deleteRow, true),
        table("delete-column", t.deleteColumn, true),
        table("delete-table", t.deleteTable, true),
      ],
    ];
  } else {
    contextGroups = [
      [
        {
          // Each tap steps paragraph -> H1 -> H2 -> H3 -> paragraph.
          label: t.toolbarHeading,
          content: block.heading ? `H${block.heading}` : "H",
          on: block.heading > 0,
          run: toggle("heading"),
        },
        {
          label: t.toolbarBold,
          content: "B",
          className: "kbt-bold",
          run: () => send(TOGGLE_MARK_EVENT, "bold"),
        },
        {
          label: t.toolbarItalic,
          content: "I",
          className: "kbt-italic",
          run: () => send(TOGGLE_MARK_EVENT, "italic"),
        },
      ],
      [
        {
          label: t.menuBulletList,
          content: <BulletListIcon />,
          on: block.bulletList,
          run: toggle("bullet-list"),
        },
        {
          label: t.menuOrderedList,
          content: <NumberedListIcon />,
          on: block.orderedList,
          run: toggle("ordered-list"),
        },
        {
          label: t.menuBlockquote,
          content: "❝",
          on: block.quote,
          run: toggle("blockquote"),
        },
        {
          label: t.menuCodeBlock,
          content: "</>",
          className: "kbt-code",
          run: () => send(INSERT_BLOCK_EVENT, "code-block"),
        },
      ],
    ];
  }
  const groups = [editGroup, ...contextGroups];

  return (
    <div
      className="keyboard-toolbar"
      role="toolbar"
      aria-label={t.toolbarLabel}
      style={panelInset ? { right: panelInset } : undefined}
    >
      <div className="keyboard-toolbar-format">
        {groups.map((group, g) => (
          <div key={g} className="keyboard-toolbar-group">
            {group.map((b) => (
              <button
                key={b.label}
                type="button"
                className={`keyboard-toolbar-button ${b.className ?? ""}`}
                aria-label={b.label}
                aria-pressed={b.on}
                // Some edits leave the selection where it was (an image's
                // new width), so no selectionchange re-reads the caret.
                {...pressKeepingFocus(() => {
                  b.run();
                  update();
                })}
              >
                {b.content}
              </button>
            ))}
          </div>
        ))}
      </div>
      {/* Outside the scrolling row, so it never scrolls out of reach. */}
      <button
        type="button"
        className="keyboard-toolbar-button"
        aria-label={t.toolbarMore}
        {...pressKeepingFocus(() => send(EDITOR_MORE_EVENT))}
      >
        <MoreIcon />
      </button>
      {aiFeatures(settings).chat && (
        <button
          type="button"
          className="keyboard-toolbar-button keyboard-toolbar-ai"
          aria-label={t.askAi}
          {...pressKeepingFocus(() => send(TOGGLE_FLOATING_CHAT_EVENT))}
        >
          ✦ AI
        </button>
      )}
    </div>
  );
}
