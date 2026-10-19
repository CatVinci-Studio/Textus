import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

/**
 * Blanks to fill: 【开幕日期】, 【场馆名称】 - the Agent writes what it
 * doesn't know this way rather than inventing it (agent.rs). Each shows as
 * a chip; clicking one asks to fill it (FILL_SLOT_EVENT, handled by the
 * editor with suggestions from the document's context).
 */

/** A blank's text: full-width brackets around a short label. */
export const FILL_SLOT = /【([^【】\n]{1,40})】/g;

/** Dispatched (bubbling) from the editor that holds the clicked blank. */
export const FILL_SLOT_EVENT = "textus:fill-slot";

export interface FillSlotRequest {
  /** The blank's range in the document. */
  from: number;
  to: number;
  /** What it asks for, without the brackets. */
  label: string;
  /** Where to put the card, in viewport coordinates. */
  rect: { left: number; top: number; bottom: number };
}

/** Sentence punctuation: a blank names one thing (开幕日期, 场馆); a bracket
 *  holding a phrase like 【17岁，雨天，别开窗】 is the writer's own text. */
const PHRASE = /[，,。！!？?；;、：:…]/;

/** The blanks in `doc`, in order. Code is left alone, and so are brackets
 *  that are not blanks: a phrase (PHRASE), or a bracket standing as a whole
 *  line on its own - a scene or section mark in prose (【第一幕】), where
 *  the Agent's blanks always sit inside a sentence or after a label. */
export function findFillSlots(
  doc: ProseNode,
): { from: number; to: number; label: string }[] {
  const slots: { from: number; to: number; label: string }[] = [];
  doc.descendants((node, pos, parent) => {
    if (node.type.spec.code || parent?.type.spec.code) return false;
    if (!node.isText || !node.text) return true;
    if (node.marks.some((mark) => mark.type.spec.code)) return false;
    for (const match of node.text.matchAll(FILL_SLOT)) {
      if (
        PHRASE.test(match[1]) ||
        parent?.textContent.trim() === match[0] ||
        parent?.type.name === "heading"
      )
        continue;
      const from = pos + (match.index ?? 0);
      slots.push({ from, to: from + match[0].length, label: match[1].trim() });
    }
    return false;
  });
  return slots;
}

const fillSlotKey = new PluginKey<DecorationSet>("fill-slots");

function decorate(doc: ProseNode): DecorationSet {
  return DecorationSet.create(
    doc,
    findFillSlots(doc).map((slot) =>
      Decoration.inline(slot.from, slot.to, {
        class: "fill-slot",
        "data-fill-slot": slot.label,
      }),
    ),
  );
}

export const fillSlotPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: fillSlotKey,
      state: {
        init: (_, state) => decorate(state.doc),
        apply: (tr, previous) => (tr.docChanged ? decorate(tr.doc) : previous),
      },
      props: {
        decorations: (state) => fillSlotKey.getState(state),
        handleClick(view, pos, event) {
          const target = (event.target as HTMLElement | null)?.closest(
            ".fill-slot",
          );
          if (!target) return false;
          const slot = findFillSlots(view.state.doc).find(
            (s) => s.from <= pos && pos <= s.to,
          );
          if (!slot) return false;
          const box = target.getBoundingClientRect();
          view.dom.dispatchEvent(
            new CustomEvent<FillSlotRequest>(FILL_SLOT_EVENT, {
              bubbles: true,
              detail: {
                ...slot,
                rect: { left: box.left, top: box.top, bottom: box.bottom },
              },
            }),
          );
          return true;
        },
      },
    }),
);
