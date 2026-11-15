import type { Ctx } from "@milkdown/kit/ctx";
import { tableSchema } from "@milkdown/kit/preset/gfm";

/**
 * A table may be its header row alone, as Markdown allows: Milkdown's asks
 * for one more row, so the last row under the header couldn't be deleted.
 */
export function allowHeaderOnlyTables(ctx: Ctx): void {
  ctx.update(tableSchema.key, (prev) => (c) => ({
    ...prev(c),
    content: "table_header_row table_row*",
  }));
}
