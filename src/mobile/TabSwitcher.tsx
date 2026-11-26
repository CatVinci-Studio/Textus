import { useSettings } from "../prefs/SettingsContext";
import { useMenuButton } from "../engine/controls/useMenuButton";
import type { ContextMenuEntry } from "../engine/controls/ContextMenu";
import { useIslands } from "../engine/layout/useIslands";
import { panesOf } from "../engine/layout/tree";
import {
  tabIsDirty,
  tabTip,
  tabTitle,
  type DocTab,
} from "../document/doc-tabs";
import "./TabSwitcher.css";

/**
 * A phone's tabs, behind the document's name in the bar: the name and the
 * count of open tabs open a menu of every tab in its row's order (pinned
 * first), the one in front ticked; then New, as the row's + was; then the
 * tab in front's own menu, as its tab's was. The desktop keeps its row.
 */
export function TabSwitcher({
  tabs,
  activeTabId,
  zen,
  onActivate,
  add,
  menuFor,
}: {
  tabs: DocTab[];
  activeTabId: string;
  zen: boolean;
  onActivate: (id: string) => void;
  /** The row's +: a document, or over a conversation another one. */
  add: { label: string; onSelect: () => void };
  /** A tab's menu among `row` (documentTabMenu). */
  menuFor: (id: string, row: DocTab[]) => ContextMenuEntry[];
}) {
  const { t } = useSettings();
  // The order the row keeps (pins, drags, a restored session); a phone's
  // islands are one.
  const layout = useIslands(zen);
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const row = panesOf(layout.root).flatMap((pane) =>
    pane.tabs.flatMap((id) => byId.get(id) ?? []),
  );
  const front = byId.get(activeTabId);
  const list = useMenuButton(() => [
    ...row.map((tab) => ({
      label: `${tabTitle(tab, t)}${tabIsDirty(tab) ? " •" : ""}`,
      hint: tabTip(tab, t),
      checked: tab.id === activeTabId,
      onSelect: () => onActivate(tab.id),
    })),
    "separator" as const,
    add,
    ...(front ? ["separator" as const, ...menuFor(front.id, row)] : []),
  ]);
  return (
    <>
      <button
        type="button"
        className="tab-switcher-button"
        aria-label={`${t.menuAllTabs}: ${front ? tabTitle(front, t) : ""}`}
        {...list.button}
      >
        <span className="tx-truncate tab-switcher-name">
          {front ? tabTitle(front, t) : ""}
        </span>
        <span className="tab-switcher-count">{row.length}</span>
      </button>
      {list.menu}
    </>
  );
}
