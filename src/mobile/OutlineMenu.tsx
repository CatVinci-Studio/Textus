import { useMemo } from "react";
import { useSettings } from "../prefs/SettingsContext";
import {
  ContextMenu,
  type ContextMenuItem,
} from "../engine/controls/ContextMenu";
import { parseHeadings } from "../files/outline-parse";
import { currentHeading } from "../files/outline-current";
import { plainInline } from "../utils/markdown-plain";
import { noteJump } from "../editor/nav-history";
import { setTabJump } from "../editor/tab-jump";

/**
 * The document's outline on a phone, a menu where ⋯'s was: its headings,
 * indented by level, the one being read ticked. A row goes there, as the
 * sidebar's outline does.
 */
export function OutlineMenu({
  content,
  tabId,
  at,
  onClose,
}: {
  content: string;
  /** The tab whose editor a row scrolls. */
  tabId: string;
  /** Where it hangs: ⋯'s corner and the button. */
  at: { x: number; y: number; anchor: HTMLElement | null };
  onClose: () => void;
}) {
  const { t } = useSettings();
  const items = useMemo(() => {
    const current = currentHeading(tabId);
    const rows: ContextMenuItem[] = [];
    parseHeadings(content).forEach((heading, index) => {
      // An empty heading keeps its place in the count, not a row.
      if (!heading.text.trim()) return;
      rows.push({
        label: plainInline(heading.text),
        depth: heading.level,
        current: index === current,
        onSelect: () => {
          // The editor scrolls there as every jump does (revealPosition).
          noteJump();
          setTabJump(tabId, { kind: "outline", index }, true);
        },
      });
    });
    return rows;
  }, [content, tabId]);
  return (
    <ContextMenu
      {...at}
      alignEnd
      heading={t.outlineTab}
      items={
        items.length > 0
          ? items
          : [{ label: t.outlineEmpty, onSelect: () => {}, disabled: true }]
      }
      onClose={onClose}
    />
  );
}
