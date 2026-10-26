import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

// WebKit commits an IME composition as a delete of the preedit, then an
// insert. A delete that empties a positioned element removes it (a table
// cell's <p>), splitting the line. The ancestors are noted on `beforeinput`
// and, if the delete detached them, put back before the insert.

interface Link {
  node: Node;
  parent: Node;
  prev: Node | null;
  next: Node | null;
}

/** The composition's textblock and its ancestors up to the editor root,
 *  innermost first. */
function ancestry(view: EditorView): Link[] {
  const selection = view.dom.ownerDocument.getSelection();
  let node: Node | null = selection?.anchorNode ?? null;
  if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
  const links: Link[] = [];
  while (node && node !== view.dom && node.parentNode) {
    links.push({
      node,
      parent: node.parentNode,
      prev: node.previousSibling,
      next: node.nextSibling,
    });
    node = node.parentNode;
  }
  return node === view.dom ? links : [];
}

/** Whether `child` is what WebKit leaves where it pruned `node`. Never an
 *  element ProseMirror rendered: a real empty list item looks the same. */
function isStandIn(child: Node, node: Node): boolean {
  if ((child as { pmViewDesc?: unknown }).pmViewDesc) return false;
  return (
    child.nodeName === "BR" ||
    (child.nodeType === Node.TEXT_NODE && !child.textContent) ||
    (child.nodeName === node.nodeName && !child.textContent)
  );
}

/** Puts `link.node` back between its old siblings, dropping the stand-ins
 *  the delete left. With one neighbour left, only the node beside it can be
 *  a stand-in; with neither, it stays out and ProseMirror redraws it. */
function reattach({ node, parent, prev, next }: Link): void {
  const prevHere = prev === null || prev.parentNode === parent;
  const nextHere = next === null || next.parentNode === parent;
  if (!prevHere && !nextHere) return;
  const afterPrev = () => (prev ? prev.nextSibling : parent.firstChild);
  const gap: Node[] = [];
  if (prevHere && nextHere)
    for (let child = afterPrev(); child && child !== next;) {
      gap.push(child);
      child = child.nextSibling;
    }
  else {
    const beside = prevHere
      ? afterPrev()
      : next
        ? next.previousSibling
        : parent.lastChild;
    if (beside) gap.push(beside);
  }
  for (const child of gap)
    if (isStandIn(child, node)) parent.removeChild(child);
  parent.insertBefore(node, nextHere ? next : afterPrev());
}

function restorePrunedComposition(view: EditorView, links: Link[]) {
  const block = links[0]?.node;
  if (!block || block.isConnected) return false;
  // Outermost first, so each level goes back into an attached parent.
  for (let i = links.length - 1; i >= 0; i--) {
    if (links[i].node.parentNode !== links[i].parent) reattach(links[i]);
  }
  // Where the delete took only the textblock, WebKit puts its placeholder
  // <br> beside the ancestor instead (straight into the <tr>).
  for (const { node, prev, next } of links) {
    const before = node.previousSibling;
    if (
      before &&
      before !== prev &&
      before.nodeName === "BR" &&
      isStandIn(before, node)
    )
      before.remove();
    const after = node.nextSibling;
    if (
      after &&
      after !== next &&
      after.nodeName === "BR" &&
      isStandIn(after, node)
    )
      after.remove();
  }
  if (!block.isConnected) return false;
  // Only an item whose whole content was the preedit gets pruned, so this
  // empties it as the delete meant to. Without the <br> the block has no line
  // box and the insert goes to the previous block.
  (block as Element).replaceChildren(document.createElement("br"));
  view.dom.ownerDocument.getSelection()?.collapse(block, 0);
  return true;
}

// Capture listeners on the window, not handleDOMEvents: ProseMirror's
// MutationObserver reacts after every listener, too late for the repair.
export const compositionPruneGuardPlugin = $prose(
  () =>
    new Plugin({
      view(view) {
        let links: Link[] = [];
        const onBeforeInput = (event: InputEvent) => {
          if (
            event.inputType === "deleteCompositionText" &&
            view.dom.contains(event.target as Node)
          )
            links = ancestry(view);
        };
        const onInput = (event: Event) => {
          if ((event as InputEvent).inputType !== "deleteCompositionText")
            return;
          restorePrunedComposition(view, links);
          links = [];
        };
        const win = view.dom.ownerDocument.defaultView ?? window;
        win.addEventListener("beforeinput", onBeforeInput, true);
        win.addEventListener("input", onInput, true);
        return {
          destroy() {
            win.removeEventListener("beforeinput", onBeforeInput, true);
            win.removeEventListener("input", onInput, true);
          },
        };
      },
    }),
);
