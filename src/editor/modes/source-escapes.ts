import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { encodedRuns } from "../markdown/link-syntax";

/**
 * In source mode a link's destination reads `%20` as a space and `%E4%B8%AD`
 * as 中, as the document does; the text keeps its escapes, and the caret
 * passes or deletes a run as one character.
 */

class Decoded extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: Decoded) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-decoded-escape";
    span.textContent = this.text;
    return span;
  }
}

/** A destination after `](`, up to its `)` or a space. */
const DEST = /\]\(<?([^)\s>]+)/g;

const decorator = new MatchDecorator({
  regexp: DEST,
  decorate(add, from, _to, match) {
    const start = from + match[0].length - match[1].length;
    for (const run of encodedRuns(match[1]))
      add(
        start + run.from,
        start + run.to,
        Decoration.replace({ widget: new Decoded(run.text) }),
      );
  },
});

const escapes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorator.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = decorator.updateDeco(update, this.decorations);
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
      ),
  },
);

export function sourceEscapes(): Extension {
  return escapes;
}
