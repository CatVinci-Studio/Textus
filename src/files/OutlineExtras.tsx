import { useEffect, useState, type CSSProperties } from "react";
import { getActiveDocument } from "../plugins/app-bridge";
import {
  askOutline,
  onOutlineProviders,
  type PluginOutlineItem,
} from "../plugins/contributions/outline-providers";
import { Tooltip } from "../engine/controls/Tooltip";
import { noteJump } from "../editor/nav-history";
import { setTabJump } from "../editor/tab-jump";

/** How long the document rests before plugins are asked again. */
const ASK_MS = 400;

/** What plugins add to the outline of the document in front, asked again
 *  as it changes and as plugins come and go. */
export function usePluginOutline(content: string): PluginOutlineItem[] {
  const [items, setItems] = useState<PluginOutlineItem[]>([]);
  const [providers, setProviders] = useState(0);
  useEffect(() => onOutlineProviders(() => setProviders((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      const blocks = getActiveDocument()?.blocks() ?? [];
      void askOutline(blocks).then((found) => live && setItems(found));
    }, ASK_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [content, providers]);
  return items;
}

/** The plugins' rows, under the headings: each goes to its block. */
export function PluginOutlineRows({
  items,
  tabId,
}: {
  items: PluginOutlineItem[];
  tabId: string;
}) {
  return items.map((item, i) => (
    <div
      key={`${item.plugin}:${item.block}:${i}`}
      className="outline-row"
      role="treeitem"
      aria-level={item.level}
      data-plugin={item.plugin}
      style={{ "--depth": item.level - 1 } as CSSProperties}
      onClick={() => {
        noteJump();
        setTabJump(
          tabId,
          { kind: "place", place: { block: item.block } },
          true,
        );
      }}
    >
      <span className="outline-toggle-spacer" />
      <span className="tree-row">
        {/* The level's room, empty: its words line up with the headings'. */}
        <span className="outline-level" aria-hidden="true" />
        <Tooltip text={item.text} description={null} whenCut>
          <span className="tx-truncate tree-label">{item.text}</span>
        </Tooltip>
      </span>
    </div>
  ));
}
