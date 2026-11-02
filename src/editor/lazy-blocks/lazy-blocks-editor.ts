import { nodeViewCtx, schemaCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { $prose } from "@milkdown/kit/utils";
import { LazyBlocksDrawer } from "./lazy-blocks-drawer";
import { lazyBlockNodeViews } from "./lazy-block-views";
import { createLazyBlocksPlugin } from "./lazy-blocks-state";

// A long document drawn lazily, put into the Milkdown editor.

export const lazyBlocksPlugin = $prose(() =>
  createLazyBlocksPlugin({ view: (view) => new LazyBlocksDrawer(view) }),
);

/**
 * Milkdown builds the view's node views from the ones registered by then
 * and spreads the view options over them. Read as the view is made (a
 * getter), these are the same node views, every block type's wrapped, so a
 * long document's first drawing already has its placeholders.
 */
export function withLazyBlockViews<T extends object>(ctx: Ctx, options: T): T {
  return Object.defineProperty(options, "nodeViews", {
    enumerable: true,
    get: () =>
      lazyBlockNodeViews(
        ctx.get(schemaCtx),
        Object.fromEntries(ctx.get(nodeViewCtx)),
      ),
  });
}
