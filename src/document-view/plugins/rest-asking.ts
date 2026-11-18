import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { PluginKey, PluginView } from "@milkdown/kit/prose/state";
import {
  type Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { cachedDocument } from "../../editor/markdown/doc-markdown";
import type { SentBlock } from "../../editor/markdown/doc-blocks";

/** How long the document (or its scrolling) rests before plugins are
 *  asked again. */
const ASK_MS = 400;
/** Blocks either side of those in sight that are asked about too, so a
 *  short scroll finds them answered already. */
const AROUND = 10;

interface RestAsking<T extends { block: string }> {
  /** Where the drawn answers are kept (a metaDecorations state). */
  key: PluginKey<DecorationSet>;
  /** Whether any plugin answers; nothing is asked while none does. */
  active(): boolean;
  /** Called when plugins start or stop answering; gives the unsubscribe. */
  subscribe(changed: () => void): () => void;
  /** The answers, and the plugins too slow to give theirs this time. */
  ask(
    blocks: SentBlock[],
    all: readonly SentBlock[],
    path: string | null,
  ): Promise<{ answers: T[]; late: string[] }>;
  /** One answer on the block at `pos`; each decoration's spec names its
   *  `plugin`. */
  draw(block: ProseNode, pos: number, answer: T): Decoration[];
}

/** The top-level blocks in sight, first and last. */
export function inSight(view: EditorView): [number, number] {
  const count = view.state.doc.childCount;
  const scroller = view.dom.closest(".editor-scroll");
  if (!scroller) return [0, count - 1];
  const box = scroller.getBoundingClientRect();
  const left = view.dom.getBoundingClientRect().left + 24;
  const at = (top: number) => {
    const found = view.posAtCoords({ left, top });
    return found
      ? view.state.doc
          .resolve(Math.min(found.pos, view.state.doc.content.size))
          .index(0)
      : null;
  };
  return [at(box.top + 1) ?? 0, at(box.bottom - 1) ?? count - 1];
}

/**
 * Asks plugins about the blocks in sight once the document, or its
 * scrolling, rests, and draws their answers; an answer for a document that
 * has moved on since is dropped and asked again. A plugin too slow to
 * answer (the page busy after a jump) keeps what it drew before and is
 * asked once more.
 */
export function askAtRest<T extends { block: string }>(
  ctx: Ctx,
  view: EditorView,
  docPath: { readonly current: string | null },
  asking: RestAsking<T>,
): PluginView {
  const { key } = asking;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let asked = 0;
  // Asked again already for a late plugin: once, not on and on.
  let retried = false;
  const ask = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), ASK_MS);
  };
  const run = async () => {
    const turn = ++asked;
    if (!asking.active()) {
      if (key.getState(view.state) !== DecorationSet.empty)
        view.dispatch(view.state.tr.setMeta(key, DecorationSet.empty));
      return;
    }
    const doc = view.state.doc;
    const all = cachedDocument(ctx, doc).blocks;
    const [first, last] = inSight(view);
    const sent = all.slice(
      Math.max(0, first - AROUND),
      Math.min(all.length, last + AROUND + 1),
    );
    const { answers, late } = await asking.ask(sent, all, docPath.current);
    // Asked again meanwhile, or the text moved on: that answer wins.
    if (turn !== asked || view.isDestroyed) return;
    if (view.state.doc !== doc) {
      ask();
      return;
    }
    const starts: number[] = [];
    doc.forEach((_node, pos) => starts.push(pos));
    const index = new Map(all.map((b, i) => [b.id, i]));
    const out: Decoration[] = [];
    for (const answer of answers) {
      const i = index.get(answer.block);
      if (i !== undefined)
        out.push(...asking.draw(doc.child(i), starts[i], answer));
    }
    const kept = late.length
      ? (key.getState(view.state) ?? DecorationSet.empty).find(
          undefined,
          undefined,
          (spec) => late.includes((spec as { plugin?: string }).plugin ?? ""),
        )
      : [];
    view.dispatch(
      view.state.tr.setMeta(key, DecorationSet.create(doc, [...out, ...kept])),
    );
    if (late.length && !retried) {
      retried = true;
      ask();
    } else retried = false;
  };
  const stopScroll = onEditorScroll(view, ask);
  const stop = asking.subscribe(ask);
  ask();
  return {
    update(_view, prevState) {
      if (prevState.doc !== view.state.doc && asking.active()) ask();
    },
    destroy() {
      clearTimeout(timer);
      stop();
      stopScroll();
    },
  };
}

/** Where `anchor` first is in one of the block's runs of text. */
function anchorIn(
  block: ProseNode,
  pos: number,
  anchor: string,
): [number, number] | null {
  let found: [number, number] | null = null;
  block.descendants((node, at) => {
    if (found) return false;
    const i = node.isText ? (node.text ?? "").indexOf(anchor) : -1;
    if (i >= 0) {
      const from = pos + 1 + at + i;
      found = [from, from + anchor.length];
    }
    return !node.isText;
  });
  return found;
}

/** The words an answer is about: its `anchor` if the block has them, else
 *  all its text. */
export function answerRange(
  block: ProseNode,
  pos: number,
  anchor: string | undefined,
): [number, number] {
  return (
    (anchor && anchorIn(block, pos, anchor)) || [
      pos + 1,
      pos + block.nodeSize - 1,
    ]
  );
}

/** Calls `cb` whenever whatever scrolls `view` scrolls. The view is made
 *  before it is in the page, so its scroller is found as scrolls come. */
export function onEditorScroll(view: EditorView, cb: () => void): () => void {
  const scrolled = (e: Event) => {
    if (e.target instanceof Node && e.target.contains(view.dom)) cb();
  };
  document.addEventListener("scroll", scrolled, {
    capture: true,
    passive: true,
  });
  return () =>
    document.removeEventListener("scroll", scrolled, { capture: true });
}
