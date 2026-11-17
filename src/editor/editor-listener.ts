import {
  EditorViewReady,
  InitReady,
  SerializerReady,
  prosePluginsCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { type Ctx, createSlice, type MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type Selection } from "@milkdown/kit/prose/state";

/**
 * The editor's mounted, updated, selection and destroy callbacks, as
 * Milkdown's listener plugin gives them, without its whole-document
 * serialize as each editor is built: Markdown is written only for a
 * `markdownUpdated` listener, and only once the document changes.
 */
class Listeners {
  readonly list = {
    mounted: [] as ((ctx: Ctx) => void)[],
    updated: [] as ((ctx: Ctx, doc: ProseNode, prev: ProseNode) => void)[],
    markdownUpdated: [] as ((ctx: Ctx, markdown: string) => void)[],
    selectionUpdated: [] as ((ctx: Ctx, selection: Selection) => void)[],
    destroy: [] as ((ctx: Ctx) => void)[],
  };
  mounted(fn: (ctx: Ctx) => void) {
    this.list.mounted.push(fn);
    return this;
  }
  updated(fn: (ctx: Ctx, doc: ProseNode, prev: ProseNode) => void) {
    this.list.updated.push(fn);
    return this;
  }
  markdownUpdated(fn: (ctx: Ctx, markdown: string) => void) {
    this.list.markdownUpdated.push(fn);
    return this;
  }
  selectionUpdated(fn: (ctx: Ctx, selection: Selection) => void) {
    this.list.selectionUpdated.push(fn);
    return this;
  }
  destroy(fn: (ctx: Ctx) => void) {
    this.list.destroy.push(fn);
    return this;
  }
}

export const listenerCtx = createSlice(new Listeners(), "textusListener");

/** Changes are told once typing rests this long, as Milkdown's are. */
const QUIET_MS = 200;

export const listener: MilkdownPlugin = (ctx) => {
  ctx.inject(listenerCtx, new Listeners());
  return async () => {
    await ctx.wait(InitReady);
    await ctx.wait(SerializerReady);
    const { list } = ctx.get(listenerCtx);
    let prevDoc: ProseNode | null = null;
    let latest: ProseNode | null = null;
    let prevSelection: Selection | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tell = () => {
      timer = null;
      const doc = latest;
      latest = null;
      if (!doc || !prevDoc || prevDoc.eq(doc)) return;
      const prev = prevDoc;
      prevDoc = doc;
      for (const fn of list.updated) fn(ctx, doc, prev);
      if (list.markdownUpdated.length) {
        const markdown = ctx.get(serializerCtx)(doc);
        for (const fn of list.markdownUpdated) fn(ctx, markdown);
      }
    };
    const plugin = new Plugin({
      key: new PluginKey("TEXTUS_LISTENER"),
      view: () => ({
        destroy: () => {
          if (timer) clearTimeout(timer);
          for (const fn of list.destroy) fn(ctx);
        },
      }),
      state: {
        init: (_, instance) => {
          prevDoc = instance.doc;
        },
        apply: (tr) => {
          const selection = tr.selection;
          if (!prevSelection || !selection.eq(prevSelection)) {
            prevSelection = selection;
            for (const fn of list.selectionUpdated) fn(ctx, selection);
          }
          if (!(tr.docChanged || tr.storedMarksSet)) return;
          if (tr.getMeta("addToHistory") === false) return;
          latest = tr.doc;
          if (timer) clearTimeout(timer);
          timer = setTimeout(tell, QUIET_MS);
        },
      },
    });
    ctx.update(prosePluginsCtx, (plugins) => plugins.concat(plugin));
    await ctx.wait(EditorViewReady);
    for (const fn of list.mounted) fn(ctx);
  };
};
