import { useMemo } from "react";
import { useSettings } from "../prefs/SettingsContext";
import {
  ActionSheet,
  type ActionSheetItem,
} from "../engine/controls/ActionSheet";
import { parseHeadings } from "../files/outline-parse";
import { currentHeading } from "../files/outline-current";
import { plainInline } from "../utils/markdown-plain";
import { noteJump } from "../editor/nav-history";
import { setTabJump } from "../editor/tab-jump";

/**
 * The document's outline on a phone: its headings, indented by level, the
 * one being read ticked. A row goes there, as the sidebar's outline does.
 */
export function OutlineSheet({
  content,
  tabId,
  onClose,
}: {
  content: string;
  /** The tab whose editor a row scrolls. */
  tabId: string;
  onClose: () => void;
}) {
  const { t } = useSettings();
  const items = useMemo(() => {
    const at = currentHeading(tabId);
    const rows: ActionSheetItem[] = [];
    parseHeadings(content).forEach((heading, index) => {
      // An empty heading keeps its place in the count, not a row.
      if (!heading.text.trim()) return;
      rows.push({
        label: plainInline(heading.text),
        depth: heading.level,
        current: index === at,
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
    <ActionSheet
      title={t.outlineTab}
      items={
        items.length > 0
          ? items
          : [{ label: t.outlineEmpty, onSelect: () => {}, disabled: true }]
      }
      onClose={onClose}
    />
  );
}
