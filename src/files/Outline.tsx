import { tabElement } from "../engine/layout/tab-element";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseHeadings } from "./outline-parse";
import { ChevronIcon } from "../engine/controls/icons";
import { useSettings } from "../prefs/SettingsContext";
import { HEADING_PLACEHOLDER } from "../editor/lazy-blocks/lazy-block-views";
import { useTreeKeys } from "../engine/controls/useTreeKeys";
import { Tooltip } from "../engine/controls/Tooltip";
import { ContextMenu } from "../engine/controls/ContextMenu";
import { Presence } from "../engine/motion/usePresence";
import { noteJump } from "../editor/nav-history";
import { setTabJump } from "../editor/tab-jump";
import { headingSlug } from "../editor/markdown/link-target";
import "./FileTree.css";

interface OutlineProps {
  content: string;
  /** The tab whose document it lists, which scrolls to a row's heading. */
  tabId: string;
}

// A long document's headings out of sight are placeholders, in their place.
const HEADINGS = `:scope > :is(h1, h2, h3, h4, h5, h6, ${HEADING_PLACEHOLDER})`;

/** The index of the section being read in the active editor: the last
 *  top-level heading just below the scroller's top, or -1 above the first. */
function currentHeading(): number {
  const scroller = tabElement()?.querySelector(":scope > .editor-scroll");
  const root = scroller?.querySelector(".editor-content .ProseMirror");
  if (!scroller || !root) return -1;
  const line = scroller.getBoundingClientRect().top + 80;
  const headings = root.querySelectorAll(HEADINGS);
  let current = -1;
  for (let i = 0; i < headings.length; i++) {
    // Folded away in a <details>: no place on screen, not being read.
    if (headings[i].getClientRects().length === 0) continue;
    if (headings[i].getBoundingClientRect().top > line) break;
    current = i;
  }
  return current;
}

/** A heading's source as it reads in the document: inline code, emphasis
 *  and link syntax dropped, so "`text-spacing`" shows as text-spacing. */
function headingLabel(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]+)`+/g, "$1")
    .replace(/(\*\*|__|~~|==)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/([*_])(?=\S)(.+?)(?<=\S)\1/g, "$2");
}

export function Outline({ content, tabId }: OutlineProps) {
  const { t } = useSettings();
  // The editor scrolls there as every jump does (revealPosition).
  const goTo = (index: number) => {
    noteJump();
    setTabJump(tabId, { kind: "outline", index }, true);
  };
  const headings = useMemo(() => {
    // Collapse is keyed by level + text + repeat, not index, so a new heading
    // above doesn't move it.
    const seen = new Map<string, number>();
    return parseHeadings(content).map((h, index, all) => {
      const base = `${h.level}|${h.text}`;
      const nth = seen.get(base) ?? 0;
      seen.set(base, nth + 1);
      const next = all[index + 1];
      return {
        ...h,
        index,
        id: `${base}|${nth}`,
        hasChildren: next !== undefined && next.level > h.level,
      };
    });
  }, [content]);
  // A heading row's own: a link to it, and its section selected.
  const headingItems = (text: string, index: number) => {
    const label = headingLabel(text);
    return [
      {
        label: t.outlineCopyLink,
        onSelect: () =>
          void navigator.clipboard
            .writeText(`[${label}](#${headingSlug(label)})`)
            .catch(() => {}),
      },
      {
        label: t.outlineSelectSection,
        onSelect: () => {
          noteJump();
          setTabJump(tabId, { kind: "outline", index, select: true }, true);
        },
      },
      "separator" as const,
    ];
  };
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const treeRef = useRef<HTMLDivElement>(null);
  const treeKeys = useTreeKeys(treeRef);
  const current = useCurrentHeading(content);
  /** Where the menu is open, and the heading row it is on, if any. */
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    heading?: (typeof headings)[number];
  } | null>(null);

  const visible = useMemo(() => {
    const rows: typeof headings = [];
    // While inside a collapsed section, everything deeper than its heading
    // stays hidden until a heading at its level or above closes it.
    let hiddenBelow = Infinity;
    for (const h of headings) {
      if (h.level > hiddenBelow) continue;
      hiddenBelow = Infinity;
      rows.push(h);
      if (h.hasChildren && collapsed.has(h.id)) hiddenBelow = h.level;
    }
    return rows;
  }, [headings, collapsed]);

  if (headings.length === 0) {
    return <p className="tx-list-note">{t.outlineEmpty}</p>;
  }

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const parents = headings.filter((h) => h.hasChildren).map((h) => h.id);
  const foldAll = (fold: boolean) => setCollapsed(new Set(fold ? parents : []));

  // A tree: arrow keys fold and walk it, Enter goes to the heading.
  return (
    <div
      className="file-tree"
      ref={treeRef}
      role="tree"
      aria-label={t.outlineTab}
      onKeyDown={treeKeys}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {visible.map((h) => {
        const isCollapsed = collapsed.has(h.id);
        return (
          <div
            key={h.id}
            className="outline-row"
            role="treeitem"
            aria-level={h.level}
            aria-expanded={h.hasChildren ? !isCollapsed : undefined}
            aria-current={h.index === current ? "location" : undefined}
            style={{ paddingLeft: (h.level - 1) * 14 }}
            onClick={() => goTo(h.index)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ x: e.clientX, y: e.clientY, heading: h });
            }}
          >
            {h.hasChildren ? (
              <Tooltip text={isCollapsed ? t.outlineExpand : t.outlineCollapse}>
                <span
                  className="outline-toggle"
                  data-tree-toggle
                  aria-hidden="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Option/Alt-click folds or unfolds every heading.
                    if (e.altKey) foldAll(!isCollapsed);
                    else toggle(h.id);
                  }}
                >
                  <ChevronIcon
                    className={`chevron ${isCollapsed ? "" : "chevron-open"}`}
                  />
                </span>
              </Tooltip>
            ) : (
              <span className="outline-toggle-spacer" />
            )}
            <span
              className={`tree-row${h.index === current ? " tree-row-active" : ""}`}
            >
              <span className="outline-level" aria-hidden="true">
                H{h.level}
              </span>
              <span className="tree-label">{headingLabel(h.text)}</span>
            </span>
          </div>
        );
      })}
      <Presence show={menu !== null}>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={[
              ...(menu.heading
                ? headingItems(menu.heading.text, menu.heading.index)
                : []),
              { label: t.outlineExpandAll, onSelect: () => foldAll(false) },
              { label: t.outlineCollapseAll, onSelect: () => foldAll(true) },
            ]}
            onClose={() => setMenu(null)}
          />
        )}
      </Presence>
    </div>
  );
}

/** The index of the heading the reader is at, following any scroller: the
 *  scroll event doesn't bubble, so it is caught on the way down. */
function useCurrentHeading(content: string): number {
  const [current, setCurrent] = useState(-1);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCurrent(currentHeading()));
    };
    update();
    document.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", update, true);
    };
  }, [content]);
  return current;
}
