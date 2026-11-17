import { editorViewCtx } from "@milkdown/kit/core";
import { NodeSelection, type Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { ContextMenuEntry } from "../../engine/controls/ContextMenu";
import type { Strings } from "../../i18n/strings";
import type { EditorRunner } from "../useEditorRunner";
import {
  blockAround,
  caretInto,
  deleteBlock,
  duplicateBlock,
  type HandledBlock,
} from "./block-commands";
import { applyBlockKind } from "./block-kinds";
import { menuKinds } from "./block-kind-list";

/** A block handle's menu, for the block at `pos`. */
export interface BlockMenu {
  pos: number;
}

/** Runs `make` on the block still at `pos`; nothing once it has gone. */
function onBlock(
  run: EditorRunner,
  pos: number,
  make: (view: EditorView, block: HandledBlock) => Transaction | void,
): boolean {
  return (
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const block = blockAround(view.state.doc, pos);
      if (!block || block.pos !== pos) return false;
      const tr = make(view, block);
      if (tr) view.dispatch(tr);
      view.focus();
      return true;
    }) ?? false
  );
}

export function blockMenuItems(
  run: EditorRunner,
  t: Strings,
  menu: BlockMenu,
  actions: { copy: () => void; openTableDialog: () => void },
): ContextMenuEntry[] {
  const kind = (id: string) => () =>
    applyBlockKind(run, id, actions.openTableDialog);
  const node = run((ctx) =>
    blockAround(ctx.get(editorViewCtx).state.doc, menu.pos),
  )?.node;
  // A block of text, or a list item, a quote: what Turn Into can change.
  const turns =
    !!node &&
    (node.isTextblock || /^(list_item|blockquote)$/.test(node.type.name));
  return [
    ...(turns
      ? [
          {
            label: t.blockTurnInto,
            items: menuKinds(true).map((k) => ({
              label: k.label(t),
              onSelect: () => {
                if (onBlock(run, menu.pos, (v) => caretInto(v.state, menu.pos)))
                  kind(k.id)();
              },
            })),
          },
          "separator" as const,
        ]
      : []),
    {
      label: t.blockDuplicate,
      onSelect: () =>
        onBlock(run, menu.pos, (v, b) => duplicateBlock(v.state, b)),
    },
    {
      label: t.copy,
      onSelect: () => {
        if (
          onBlock(run, menu.pos, (v, b) =>
            v.state.tr.setSelection(NodeSelection.create(v.state.doc, b.pos)),
          )
        )
          actions.copy();
      },
    },
    "separator",
    {
      label: t.codeBlockDelete,
      onSelect: () => onBlock(run, menu.pos, (v, b) => deleteBlock(v.state, b)),
    },
  ];
}
