import type { Transaction } from "@milkdown/kit/prose/state";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";

type QuickAskMeta = { type: "show"; pos: number } | { type: "hide" };

interface QuickAskState {
  pos: number | null;
  decoration: DecorationSet;
}

const quickAskKey = new PluginKey<QuickAskState>("quick-ask-widget");

/** Shows the panel's widget after document position `pos`, or hides it. */
export function setQuickAskWidget(
  tr: Transaction,
  pos: number | null,
): Transaction {
  return tr.setMeta(
    quickAskKey,
    pos === null ? { type: "hide" } : { type: "show", pos },
  );
}

/**
 * The Quick Ask panel's place in the document: a block widget after the
 * block it was opened on, so content below is pushed down and the panel maps
 * through edits. React portals the panel into it; `stopEvent` keeps
 * ProseMirror out of the panel's inputs.
 */
export function createQuickAskWidgetPlugin(options: {
  /** Hands React the widget's DOM container. */
  onMount: (el: HTMLElement) => void;
  /** That container has left the document. Passed the element that went away:
   *  on a move ProseMirror may build the replacement first, and a bare clear
   *  landing last would unmount the panel that survived. */
  onUnmount: (el: HTMLElement) => void;
}) {
  // ONE container for the panel's whole life: a fresh element per move
  // remounts the portal, wiping a half-typed follow-up and attachments.
  let anchor: HTMLElement | null = null;

  function build(doc: ProseNode, pos: number): DecorationSet {
    return DecorationSet.create(doc, [
      Decoration.widget(
        pos,
        () => {
          if (!anchor) {
            anchor = document.createElement("div");
            anchor.className = "quick-ask-anchor";
            anchor.contentEditable = "false";
          }
          options.onMount(anchor);
          return anchor;
        },
        {
          key: "quick-ask",
          side: 1,
          stopEvent: () => true,
          ignoreSelection: true,
          // On a move the same element is re-inserted at the new position,
          // possibly before the old widget is torn down; only a container
          // that is really out of the document (hidden) counts as unmounted.
          destroy: (node) =>
            queueMicrotask(() => {
              if (!node.isConnected) options.onUnmount(node as HTMLElement);
            }),
        },
      ),
    ]);
  }

  return $prose(
    () =>
      new Plugin<QuickAskState>({
        key: quickAskKey,
        state: {
          init: (): QuickAskState => ({
            pos: null,
            decoration: DecorationSet.empty,
          }),
          apply(tr, prev): QuickAskState {
            const meta = tr.getMeta(quickAskKey) as QuickAskMeta | undefined;
            if (meta?.type === "show") {
              const pos = Math.min(meta.pos, tr.doc.content.size);
              return { pos, decoration: build(tr.doc, pos) };
            }
            if (meta?.type === "hide") {
              return { pos: null, decoration: DecorationSet.empty };
            }
            if (tr.docChanged && prev.pos !== null) {
              const pos = Math.min(
                tr.mapping.map(prev.pos, 1),
                tr.doc.content.size,
              );
              const decoration = prev.decoration.map(tr.mapping, tr.doc);
              // A deletion across the widget's spot drops the decoration
              // outright; the panel is still open, so put it back where its
              // spot mapped to.
              return {
                pos,
                decoration:
                  decoration.find().length > 0
                    ? decoration
                    : build(tr.doc, pos),
              };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return quickAskKey.getState(state)?.decoration;
          },
        },
      }),
  );
}
