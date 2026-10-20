import { schemaCtx, serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/** Each editor's serializations of single top-level blocks, which a block
 *  keeps for as long as it is the same node. ProseMirror keeps an untouched
 *  block as the same object through every edit elsewhere, so after an edit
 *  only the blocks it touched are serialized again. */
const blockMarkdowns = new WeakMap<Ctx, WeakMap<ProseNode, string>>();

/** What the serializer writes for one top-level block on its own. */
export function blockMarkdown(ctx: Ctx, node: ProseNode): string {
  let known = blockMarkdowns.get(ctx);
  if (!known) blockMarkdowns.set(ctx, (known = new WeakMap()));
  let markdown = known.get(node);
  if (markdown === undefined) {
    const doc = ctx.get(schemaCtx).topNodeType.create(null, node);
    markdown = ctx.get(serializerCtx)(doc);
    known.set(node, markdown);
  }
  return markdown;
}
