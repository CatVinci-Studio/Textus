import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { markChangeSource } from "../../editor/change-source";

/**
 * How a block a plugin draws sits on the page: the column's width or the
 * pane's (`wide`), and the size its page draws at (`zoom=80`), both kept
 * in the fence's info string after the language, which other editors
 * ignore: ```` ```base wide zoom=80 ````.
 */

export interface BlockLayout {
  wide: boolean;
  /** 1 for as drawn; 0.7, 0.8, 0.9 smaller. */
  zoom: number;
}

export const BLOCK_ZOOMS = [1, 0.9, 0.8, 0.7] as const;

/** Space kept either side of a wide block, in px. */
const WIDE_GUTTER = 24;

export function layoutOf(meta: Record<string, string>): BlockLayout {
  const zoom = Number(meta.zoom) / 100;
  return {
    wide: meta.wide === "true",
    zoom: BLOCK_ZOOMS.find((z) => Math.abs(z - zoom) < 0.001) ?? 1,
  };
}

/** `meta` with the layout written in, the rest of it kept as it was. */
function withLayout(meta: string, layout: BlockLayout): string {
  const rest = meta
    .split(/\s+/)
    .filter((part) => part && part !== "wide" && !/^zoom=/.test(part));
  if (layout.wide) rest.push("wide");
  if (layout.zoom !== 1) rest.push(`zoom=${Math.round(layout.zoom * 100)}`);
  return rest.join(" ");
}

/** Writes `patch` into the block ending at `getPos()`; false when gone. */
export function setBlockLayout(
  view: EditorView,
  getPos: () => number | undefined,
  patch: Partial<BlockLayout>,
  current: BlockLayout,
): boolean {
  const end = getPos();
  if (end === undefined) return false;
  const node: ProseNode | null | undefined =
    view.state.doc.resolve(end).nodeBefore;
  if (node?.type.name !== "code_block") return false;
  const meta = withLayout(String(node.attrs.meta ?? ""), {
    ...current,
    ...patch,
  });
  view.dispatch(
    markChangeSource(
      view.state.tr.setNodeMarkup(end - node.nodeSize, undefined, {
        ...node.attrs,
        meta,
      }),
      "plugin",
    ),
  );
  return true;
}

/** Keeps `el`'s --wide-width at its pane's width, the gutter either side;
 *  returns the stop. */
export function followPaneWidth(el: HTMLElement, column: HTMLElement) {
  const pane = column.closest(".editor-content")?.parentElement ?? null;
  if (!pane) return () => {};
  const set = () => {
    // A block taken out of the page lets go of its pane.
    if (started && !el.isConnected) return observer.disconnect();
    el.style.setProperty(
      "--wide-width",
      `${Math.max(0, pane.clientWidth - 2 * WIDE_GUTTER)}px`,
    );
  };
  let started = false;
  const observer = new ResizeObserver(set);
  set();
  started = true;
  observer.observe(pane);
  return () => observer.disconnect();
}
