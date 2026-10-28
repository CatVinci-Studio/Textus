// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Settings } from "../../prefs/SettingsContext";
import { createTestEditor } from "../../document-view/editor-test-harness";
import {
  BRACKET_COMPOSITION_DELAY_MS,
  BRACKET_PAIRS,
} from "./bracket-autopair-plugin";

const editors: Editor[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

async function openView(
  markdown = "",
  settings: Partial<Settings> = {},
): Promise<{ view: EditorView; save: () => string }> {
  const editor = await createTestEditor(markdown, settings);
  editors.push(editor);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    return { view, save: () => ctx.get(serializerCtx)(view.state.doc) };
  });
}

/** Typing on a keyboard: each character goes through handleTextInput, and
 *  lands as plain text when no plugin takes it. */
function type(view: EditorView, text: string): void {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

function press(view: EditorView, key: string): boolean {
  const event = new KeyboardEvent("keydown", { key, cancelable: true });
  const handled = view.someProp("handleKeyDown", (f) => f(view, event));
  if (!handled && key === "Backspace") {
    const { from, empty } = view.state.selection;
    if (empty) view.dispatch(view.state.tr.delete(from - 1, from));
  }
  return !!handled;
}

/** The caret at the end of the first textblock reading `text`. */
function caretAfter(view: EditorView, text: string): void {
  let end = -1;
  view.state.doc.descendants((node, pos) => {
    if (end < 0 && node.isTextblock && node.textContent === text)
      end = pos + node.nodeSize - 1;
  });
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
  );
}

/** The first textblock's text with "|" at the caret. */
function withCaret(view: EditorView): string {
  const { $from } = view.state.selection;
  const text = $from.parent.textContent;
  return (
    text.slice(0, $from.parentOffset) + "|" + text.slice($from.parentOffset)
  );
}

/** Selects `word` in the first textblock that has it. */
function select(view: EditorView, word: string): void {
  let range: [number, number] | null = null;
  view.state.doc.descendants((node, pos) => {
    const at = node.isText ? node.text!.indexOf(word) : -1;
    if (!range && at >= 0) range = [pos + at, pos + at + word.length];
  });
  const [from, to] = range!;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)),
  );
}

describe("typing a bracket or quote", () => {
  it.each(Object.entries(BRACKET_PAIRS))(
    "puts %s's partner after the caret",
    async (opener, closer) => {
      const { view } = await openView("");
      caretAfter(view, "");
      type(view, opener);
      expect(withCaret(view)).toBe(`${opener}|${closer}`);
    },
  );

  it("steps over the partner when the closer is typed", async () => {
    const { view, save } = await openView("");
    caretAfter(view, "");
    type(view, "f(x) and [a] and {b}");
    expect(save()).toBe("f(x) and \\[a] and {b}\n");
    expect(withCaret(view)).toBe("f(x) and [a] and {b}|");
  });

  it('steps over a closing quote that is the same as its opener: "', async () => {
    const { view } = await openView("");
    caretAfter(view, "");
    type(view, 'say "hi" now');
    expect(withCaret(view)).toBe('say "hi" now|');
  });

  it("nests, stepping over each partner in turn", async () => {
    const { view } = await openView("");
    caretAfter(view, "");
    type(view, "（「a」）b");
    expect(withCaret(view)).toBe("（「a」）b|");
  });

  it("types a closer that it didn't put in as it is", async () => {
    const { view } = await openView("a)");
    // The caret before the file's own ")".
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)),
    );
    type(view, ")");
    expect(withCaret(view)).toBe("a)|)");
  });

  it("forgets a partner once the caret has left the pair", async () => {
    const { view } = await openView("");
    caretAfter(view, "");
    type(view, "(a");
    // Away and back: the ")" is now just text.
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
    );
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
    );
    type(view, ")");
    expect(withCaret(view)).toBe("(a)|)");
  });

  it("takes both out with Backspace right after the opener", async () => {
    const { view } = await openView("x");
    caretAfter(view, "x");
    type(view, " 【");
    press(view, "Backspace");
    expect(withCaret(view)).toBe("x |");
  });

  it("takes only the opener while text stands between", async () => {
    const { view } = await openView("");
    caretAfter(view, "");
    type(view, "(a");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)),
    );
    press(view, "Backspace");
    expect(withCaret(view)).toBe("|a)");
  });

  it("leaves a closer it didn't put in to Backspace", async () => {
    const { view } = await openView("()");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)),
    );
    press(view, "Backspace");
    expect(withCaret(view)).toBe("|)");
  });

  it("wraps a selection, which stays selected", async () => {
    const { view, save } = await openView("one two three");
    select(view, "two");
    type(view, "《");
    expect(save()).toBe("one 《two》 three\n");
    const { from, to } = view.state.selection;
    expect(view.state.doc.textBetween(from, to)).toBe("two");
  });

  it("wraps a selection with formatting in it, keeping the formatting", async () => {
    const { view, save } = await openView("a **bold** b");
    const { doc } = view.state;
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(doc, 3, doc.firstChild!.content.size - 1),
      ),
    );
    type(view, "(");
    expect(save()).toBe("a (**bold**) b\n");
  });

  it("doesn't pair right before a word", async () => {
    const { view } = await openView("word");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
    );
    type(view, "(");
    expect(withCaret(view)).toBe("(|word");
    type(view, "「");
    expect(withCaret(view)).toBe("(「|word");
  });

  it("doesn't pair an apostrophe after a word", async () => {
    const { view, save } = await openView("");
    caretAfter(view, "");
    type(view, "don't, it's 'quoted'");
    expect(save()).toBe("don't, it's 'quoted'\n");
    expect(withCaret(view)).toBe("don't, it's 'quoted'|");
  });

  it("doesn't pair in a code block, inline code or maths", async () => {
    const { view } = await openView("```\ncode\n```\n\nx `c` y $m$ z\n");
    caretAfter(view, "code");
    type(view, "(");
    expect(withCaret(view)).toBe("code(|");

    let inside = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "md_code_span") inside = pos + 2;
    });
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, inside)),
    );
    type(view, "[");
    expect(view.state.selection.$from.parent.textContent).toBe("c[");

    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "math_inline") inside = pos + 2;
    });
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, inside)),
    );
    type(view, "{");
    expect(view.state.selection.$from.parent.textContent).toBe("m{");
  });

  it("doesn't pair in a web address or in a link", async () => {
    const { view } = await openView("see https://en.wikipedia.org/wiki/Foo_\n");
    caretAfter(view, "see https://en.wikipedia.org/wiki/Foo_");
    type(view, "(");
    expect(withCaret(view)).toBe("see https://en.wikipedia.org/wiki/Foo_(|");

    const linked = await openView("[a link](https://x.org) after\n");
    linked.view.dispatch(
      linked.view.state.tr.setSelection(
        TextSelection.create(linked.view.state.doc, 4),
      ),
    );
    type(linked.view, "(");
    expect(withCaret(linked.view)).toBe("a l(|ink after");
  });

  it("still turns a typed [text](url) into a link", async () => {
    const { view, save } = await openView("");
    caretAfter(view, "");
    type(view, "[Textus](https://textus.catvinci.com) and on");
    expect(save()).toBe("[Textus](https://textus.catvinci.com) and on\n");
  });

  it("opens bold, italic and code inside a pair as at a line's end", async () => {
    const { view, save } = await openView("");
    caretAfter(view, "");
    type(view, "(**b**) and “*i*” and {`c`}");
    expect(save()).toBe("(**b**) and “*i*” and {`c`}\n");
  });

  it("still turns a typed [[wikilink]] into one", async () => {
    const { view, save } = await openView("");
    caretAfter(view, "");
    type(view, "[[Note]] next");
    expect(view.state.doc.firstChild!.firstChild!.type.name).toBe("wikilink");
    expect(save()).toBe("[[Note]] next\n");
  });

  it("still turns a typed - [ ] into a task", async () => {
    const { save, view } = await openView("");
    caretAfter(view, "");
    type(view, "- [ ] milk");
    expect(save()).toBe("* [ ] milk\n");
  });

  it("off, types brackets and quotes as they are", async () => {
    const { view } = await openView("", { autoCloseBrackets: false });
    caretAfter(view, "");
    type(view, '("[{（【「');
    expect(withCaret(view)).toBe('("[{（【「|');
  });
});

/** An input method's composition, as prosemirror-view leaves it in the
 *  document: compositionstart, the preedit text typed in as the composition
 *  runs (no handleTextInput), then the commit and compositionend. */
function compose(
  view: EditorView,
  committed: string,
  options: { preedit?: string; webkitgtk?: boolean } = {},
): void {
  const preedit = options.preedit ?? committed;
  view.dom.dispatchEvent(
    new CompositionEvent("compositionstart", { data: "" }),
  );
  expect(view.composing).toBe(true);
  const { from, to } = view.state.selection;
  view.dispatch(view.state.tr.insertText(preedit, from, to));
  if (options.webkitgtk) {
    // WebKitGTK: deleteCompositionText, then insertFromComposition.
    view.dispatch(view.state.tr.delete(from, from + preedit.length));
    view.dispatch(view.state.tr.insertText(committed, from));
  } else if (preedit !== committed) {
    view.dispatch(
      view.state.tr.insertText(committed, from, from + preedit.length),
    );
  }
  const during = view.state.doc;
  view.dom.dispatchEvent(
    new CompositionEvent("compositionend", { data: committed }),
  );
  // Nothing touches the document until the composition is over.
  expect(view.state.doc).toBe(during);
  vi.advanceTimersByTime(BRACKET_COMPOSITION_DELAY_MS + 50);
}

describe("brackets and quotes committed by an input method", () => {
  it.each([false, true])(
    "pairs a committed （, and steps over the committed ） (WebKitGTK: %s)",
    async (webkitgtk) => {
      const { view, save } = await openView("");
      caretAfter(view, "");
      vi.useFakeTimers();
      compose(view, "（", { webkitgtk });
      expect(withCaret(view)).toBe("（|）");
      compose(view, "你好", { preedit: "nihao", webkitgtk });
      expect(withCaret(view)).toBe("（你好|）");
      compose(view, "）", { webkitgtk });
      expect(withCaret(view)).toBe("（你好）|");
      expect(save()).toBe("（你好）\n");
    },
  );

  it("pairs the bracket at the end of a longer commit", async () => {
    const { view } = await openView("");
    caretAfter(view, "");
    vi.useFakeTimers();
    compose(view, "书名《", { preedit: "shuming<" });
    expect(withCaret(view)).toBe("书名《|》");
  });

  it("pairs curly quotes and steps over the closing one", async () => {
    const { view } = await openView("");
    caretAfter(view, "");
    vi.useFakeTimers();
    compose(view, "“");
    compose(view, "引文");
    compose(view, "”");
    expect(withCaret(view)).toBe("“引文”|");
  });

  it("takes both out with Backspace after a committed opener", async () => {
    const { view } = await openView("");
    caretAfter(view, "");
    vi.useFakeTimers();
    compose(view, "【");
    press(view, "Backspace");
    expect(withCaret(view)).toBe("|");
  });

  it("wraps a selection the composition started over", async () => {
    const { view, save } = await openView("看 这本书 吧");
    select(view, "这本书");
    vi.useFakeTimers();
    compose(view, "《");
    expect(save()).toBe("看 《这本书》 吧\n");
    const { from, to } = view.state.selection;
    expect(view.state.doc.textBetween(from, to)).toBe("这本书");
  });

  it("doesn't pair a committed bracket before a word or in code", async () => {
    const { view } = await openView("文字\n\n```\ncode\n```\n");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
    );
    vi.useFakeTimers();
    compose(view, "（");
    expect(withCaret(view)).toBe("（|文字");
    caretAfter(view, "code");
    compose(view, "【");
    expect(withCaret(view)).toBe("code【|");
  });

  it("doesn't pair twice when a commit also went through handleTextInput", async () => {
    const { view } = await openView("");
    caretAfter(view, "");
    vi.useFakeTimers();
    type(view, "(");
    view.dom.dispatchEvent(
      new CompositionEvent("compositionend", { data: "(" }),
    );
    vi.advanceTimersByTime(BRACKET_COMPOSITION_DELAY_MS + 50);
    expect(withCaret(view)).toBe("(|)");
  });

  it("leaves no partner behind when a committed ) finishes a typed link", async () => {
    // Chromium hands the commit to handleTextInput while still composing,
    // and the link rule takes the ")" and its "(" with the rest.
    const { view, save } = await openView("");
    caretAfter(view, "");
    type(view, "[百度](http://www.baidu.com");
    vi.useFakeTimers();
    view.dom.dispatchEvent(new CompositionEvent("compositionstart"));
    const { from } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, from, ")", () => view.state.tr.insertText(")", from)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(")", from));
    view.dom.dispatchEvent(
      new CompositionEvent("compositionend", { data: ")" }),
    );
    vi.advanceTimersByTime(BRACKET_COMPOSITION_DELAY_MS + 50);
    expect(save()).toBe("[百度](http://www.baidu.com)\n");
  });

  it("off, leaves committed brackets as they are", async () => {
    const { view } = await openView("", { autoCloseBrackets: false });
    caretAfter(view, "");
    vi.useFakeTimers();
    compose(view, "（");
    expect(withCaret(view)).toBe("（|");
  });

  it("still makes a task of a committed -【】", async () => {
    const { view, save } = await openView("");
    caretAfter(view, "");
    vi.useFakeTimers();
    compose(view, "-【");
    const item = view.state.doc.firstChild!.firstChild!;
    expect(item.attrs.checked).toBe(false);
    // The 】 and the space typed after the box go with it.
    compose(view, "】");
    type(view, " milk");
    expect(save()).toBe("* [ ] milk\n");
  });
});
