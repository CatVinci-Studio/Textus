import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { lazyModule } from "../../lazy/lazy-module";
import {
  changedRanges,
  decorateAll,
  redecorateChanged,
  touchedBlocks,
} from "../changed-ranges";
import { EMOJI_CLASS, EMOJI_SOURCE_CLASS } from "./emoji-classes";

type Names = Record<string, string>;

// GitHub's names, ~40 KB: loaded only once a document has a `:word:`.
export const emojiNames = lazyModule("emoji-shortcodes", () =>
  import("./shortcodes.json").then((m) => m.default as Names),
);

const SHORTCODE = /:([a-z0-9_+-]+):/g;

/** A block whose text may hold shortcodes: any but code. */
const isEmojiBlock = (node: ProseNode) =>
  node.isTextblock && !node.type.spec.code;

const SPEC = { emoji: true };

/** The emoji widget and the hidden source for each known shortcode in the
 *  block's text, outside code and link text. */
function shortcodes(names: Names, block: ProseNode, blockPos: number) {
  const decorations: Decoration[] = [];
  const read = (parent: ProseNode, contentPos: number) =>
    parent.forEach((child, offset) => {
      const pos = contentPos + offset;
      if (child.type.name === "md_span") return read(child, pos + 1);
      if (!child.isText || child.marks.some((m) => m.type.name === "link"))
        return;
      for (const match of child.text!.matchAll(SHORTCODE)) {
        const emoji = names[match[1]];
        if (!emoji) continue;
        const from = pos + match.index;
        const to = from + match[0].length;
        decorations.push(
          Decoration.widget(
            from,
            () => {
              const el = document.createElement("span");
              el.className = EMOJI_CLASS;
              el.contentEditable = "false";
              el.title = match[0];
              el.textContent = emoji;
              return el;
            },
            { ...SPEC, side: -1, key: `emoji:${match[1]}` },
          ),
          Decoration.inline(from, to, { class: EMOJI_SOURCE_CLASS }, SPEC),
        );
      }
    });
  read(block, blockPos + 1);
  return decorations;
}

interface EmojiState {
  set: DecorationSet;
  /** Text that may be a shortcode was seen before the names loaded. */
  wanted: boolean;
}

const key = new PluginKey<EmojiState>("emoji-shortcode");

const mayHold = (text: string) => /:[a-z0-9_+-]+:/.test(text);

function build(doc: ProseNode): EmojiState {
  const names = emojiNames.peek();
  if (names)
    return {
      set: decorateAll(doc, isEmojiBlock, (n, p) => shortcodes(names, n, p)),
      wanted: false,
    };
  return {
    set: DecorationSet.empty,
    wanted: mayHold(doc.textBetween(0, doc.content.size, "\n", " ")),
  };
}

/** The set without the shortcodes the selection is on or beside: those
 *  show their source, to edit. */
function revealed(state: EditorState, set: DecorationSet): DecorationSet {
  const { from, to } = state.selection;
  const near = set.find(from, to, (spec) => spec.emoji);
  if (!near.length) return set;
  const start = Math.min(...near.map((d) => d.from));
  const end = Math.max(...near.map((d) => d.to));
  return set.remove(set.find(start, end, (spec) => spec.emoji));
}

/** `:smile:` shows as 😄 while the file keeps the shortcode, as in
 *  Typora; the caret on one shows its source. */
export const emojiShortcodePlugin = $prose(
  () =>
    new Plugin<EmojiState>({
      key,
      state: {
        init: (_config, state) => build(state.doc),
        apply(tr, prev) {
          if (tr.getMeta(key) === "loaded") return build(tr.doc);
          if (!tr.docChanged) return prev;
          const names = emojiNames.peek();
          if (!names) {
            if (prev.wanted) return prev;
            const wanted = touchedBlocks(tr.doc, changedRanges(tr)).some(
              ([from, to]) => mayHold(tr.doc.textBetween(from, to, "\n", " ")),
            );
            return wanted ? { ...prev, wanted } : prev;
          }
          return {
            set: redecorateChanged(prev.set, tr, isEmojiBlock, (n, p) =>
              shortcodes(names, n, p),
            ),
            wanted: false,
          };
        },
      },
      props: {
        handleDOMEvents: {
          // The emoji is no text to click into: a click on it puts the caret
          // in its shortcode, which shows the source.
          mousedown(view, event) {
            const emoji = (event.target as Element).closest?.(
              `.${EMOJI_CLASS}`,
            );
            if (!emoji || event.button !== 0) return false;
            event.preventDefault();
            const pos = view.posAtDOM(emoji, 0);
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.create(view.state.doc, pos + 1),
              ),
            );
            view.focus();
            return true;
          },
        },
        decorations(state) {
          const set = key.getState(state)?.set;
          return set && set !== DecorationSet.empty
            ? revealed(state, set)
            : set;
        },
      },
      view: (editorView) => {
        let loading = false;
        const update = (view: EditorView) => {
          if (loading || !key.getState(view.state)?.wanted) return;
          loading = true;
          void emojiNames.load().then(
            () => {
              if (!view.isDestroyed)
                view.dispatch(
                  view.state.tr
                    .setMeta(key, "loaded")
                    .setMeta("addToHistory", false),
                );
            },
            () => {
              loading = false;
            },
          );
        };
        update(editorView);
        return { update };
      },
    }),
);
