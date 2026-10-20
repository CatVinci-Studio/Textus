import { headingIdGenerator } from "@milkdown/kit/preset/commonmark";
import {
  ParserReady,
  editorStateTimerCtx,
  parserCtx,
} from "@milkdown/kit/core";
import { createTimer, type MilkdownPlugin } from "@milkdown/kit/ctx";
import { Fragment, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

const isHeading = (node: ProseNode) => node.type.name === "heading";

/** Whether `tr` wrote into a heading, or removed or added one. */
export function touchesHeading(tr: Transaction): boolean {
  let found = false;
  tr.mapping.maps.forEach((map, i) => {
    if (found) return;
    const before = tr.docs[i];
    const after = tr.docs[i + 1] ?? tr.doc;
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (found) return;
      const look = (doc: ProseNode, from: number, to: number) =>
        doc.nodesBetween(from, to, (node) => {
          if (isHeading(node)) found = true;
          return !found && !node.isTextblock;
        });
      look(before, oldStart, oldEnd);
      if (!found) look(after, newStart, newEnd);
    });
  });
  return found;
}

const key = new PluginKey<number>("heading-id");

type IdOf = (node: ProseNode) => string;

/** Each heading's id as it should be, in document order: the generator's,
 *  with "-#2", "-#3" for repeats. An empty heading has none. */
function eachId(
  doc: ProseNode,
  idOf: IdOf,
  visit: (node: ProseNode, pos: number, id: string) => void,
) {
  const seen: Record<string, number> = {};
  doc.descendants((node, pos) => {
    if (!isHeading(node)) return !node.isTextblock;
    if (node.textContent.trim().length === 0) return false;
    let id = idOf(node);
    if (seen[id]) {
      seen[id] += 1;
      id += `-#${seen[id]}`;
    } else seen[id] = 1;
    visit(node, pos, id);
    return false;
  });
}

/** `doc` with its headings' ids written in - a new document, sharing every
 *  block that holds no heading. */
export function withHeadingIds(doc: ProseNode, idOf: IdOf): ProseNode {
  const ids = new Map<number, string>();
  eachId(doc, idOf, (node, pos, id) => {
    if (node.attrs.id !== id) ids.set(pos, id);
  });
  if (ids.size === 0) return doc;
  const rebuild = (node: ProseNode, pos: number): ProseNode => {
    const id = ids.get(pos);
    if (id !== undefined)
      return node.type.create({ ...node.attrs, id }, node.content, node.marks);
    if (node.isTextblock || node.childCount === 0) return node;
    const children: ProseNode[] = [];
    let changed = false;
    node.forEach((child, offset) => {
      const next = rebuild(child, pos + 1 + offset);
      changed ||= next !== child;
      children.push(next);
    });
    return changed ? node.copy(Fragment.fromArray(children)) : node;
  };
  // The document has no opening token: its children start at 0.
  const children: ProseNode[] = [];
  doc.forEach((child, offset) => children.push(rebuild(child, offset)));
  return doc.copy(Fragment.fromArray(children));
}

const HeadingIdsParsed = createTimer("HeadingIdsParsed");

/**
 * Gives a parsed document its heading ids before the editor opens it.
 * Set afterwards (as syncHeadingIdPlugin did, and the view below would),
 * the ids changed every heading in one transaction as the document
 * opened: in a long one, every heading drawn again and the page laid out
 * twice, half a second at 5k blocks.
 */
export const headingIdsOnParse: MilkdownPlugin = (ctx) => {
  ctx.record(HeadingIdsParsed);
  ctx.update(editorStateTimerCtx, (timers) => timers.concat(HeadingIdsParsed));
  return async () => {
    await ctx.wait(ParserReady);
    const parse = ctx.get(parserCtx);
    ctx.set(parserCtx, (text) =>
      withHeadingIds(parse(text), ctx.get(headingIdGenerator.key)),
    );
    ctx.done(HeadingIdsParsed);
    return () => {
      ctx.clearTimer(HeadingIdsParsed);
    };
  };
};

// How long typing in a heading rests before its id follows: setting it
// draws the heading again, which in a long document lays the page out
// again - on every keystroke, typing in a heading crawled.
const SYNC_DELAY_MS = 300;

/**
 * Each heading's `id` (its anchor, for #heading links), as Milkdown's
 * syncHeadingIdPlugin gives it. That plugin walked the whole document
 * after every change to work them out again; an id only depends on the
 * headings, so here they are worked out again only after a change to
 * one, once typing rests. The state counts those changes; the view syncs
 * when the count moved.
 */
export const headingIdPlugin = $prose((ctx) => {
  const sync = (view: EditorView) => {
    const tr = view.state.tr.setMeta("addToHistory", false).setMeta(key, true);
    eachId(view.state.doc, ctx.get(headingIdGenerator.key), (node, pos, id) => {
      if (node.attrs.id !== id)
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
    });
    if (tr.docChanged) view.dispatch(tr);
  };
  return new Plugin<number>({
    key,
    state: {
      init: () => 0,
      // Its own id updates don't count.
      apply: (tr, count) =>
        tr.docChanged && !tr.getMeta(key) && touchesHeading(tr)
          ? count + 1
          : count,
    },
    view: (view) => {
      let synced = key.getState(view.state);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const later = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (view.isDestroyed) return;
          // Not mid-composition (as Milkdown's): the attr change would
          // redraw the heading under the input method.
          if (view.composing) return later();
          synced = key.getState(view.state);
          sync(view);
        }, SYNC_DELAY_MS);
      };
      sync(view);
      return {
        update: (view) => {
          if (key.getState(view.state) !== synced) later();
        },
        destroy: () => clearTimeout(timer),
      };
    },
  });
});
