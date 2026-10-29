// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Settings } from "../../prefs/SettingsContext";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { convertRunClosedBeforeCaret } from "./md-span-autopair-plugin";
import { COMPOSE_RELOCATE_DELAY_MS } from "./enclosure";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

async function openView(
  markdown = "",
  settings: Partial<Settings> = {},
): Promise<{
  view: EditorView;
  save: () => string;
}> {
  const editor = await createTestEditor(markdown, settings);
  editors.push(editor);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    return { view, save: () => ctx.get(serializerCtx)(view.state.doc) };
  });
}

/** What an IME commit leaves behind: the composed text inserted at the
 *  caret with no handleTextInput call. */
function commit(view: EditorView, text: string): void {
  const { from, to } = view.state.selection;
  view.dispatch(view.state.tr.insertText(text, from, to));
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

function caretToEndOfFirstBlock(view: EditorView): void {
  let end = -1;
  view.state.doc.descendants((node, pos) => {
    if (end < 0 && node.isTextblock) end = pos + node.nodeSize - 1;
  });
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
  );
}

describe("delimiters committed by an IME (#134)", () => {
  it("turns **text** committed one * at a time into bold", async () => {
    const { view, save } = await openView();
    caretToEndOfFirstBlock(view);
    for (const piece of ["*", "*", "加粗文本", "*"]) {
      commit(view, piece);
      expect(convertRunClosedBeforeCaret(view, piece)).toBe(false);
    }
    commit(view, "*");
    expect(convertRunClosedBeforeCaret(view, "*")).toBe(true);
    expect(save()).toBe("**加粗文本**\n");
    // The caret sits after the new node, so typing continues outside it.
    commit(view, "后");
    expect(save()).toBe("**加粗文本**后\n");
  });

  it("converts a whole span committed at once", async () => {
    const { view, save } = await openView("前");
    caretToEndOfFirstBlock(view);
    commit(view, "*斜体*");
    expect(convertRunClosedBeforeCaret(view, "*斜体*")).toBe(true);
    expect(save()).toBe("前*斜体*\n");
  });

  it("handles strikethrough, highlight and bold-italic the same way", async () => {
    const { view, save } = await openView();
    caretToEndOfFirstBlock(view);
    for (const span of ["~~删除~~", "==高亮==", "***都有***"]) {
      commit(view, span);
      expect(convertRunClosedBeforeCaret(view, span)).toBe(true);
    }
    expect(save()).toBe("~~删除~~==高亮==***都有***\n");
  });

  it("leaves an unpaired or still-growing run literal", async () => {
    const { view } = await openView();
    caretToEndOfFirstBlock(view);
    commit(view, "a * b *");
    // "* b *" has whitespace at its edges, which no span may have.
    expect(convertRunClosedBeforeCaret(view, "*")).toBe(false);
    commit(view, " ~x~");
    // A single "~" is not strikethrough.
    expect(convertRunClosedBeforeCaret(view, "~")).toBe(false);
  });

  it("converts an opening run committed in front of its content", async () => {
    for (const [doc, run, saved] of [
      ["前斜体*后", "*", "前*斜体*后\n"],
      ["前粗体**后", "**", "前**粗体**后\n"],
    ]) {
      const { view, save } = await openView(doc);
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)),
      );
      commit(view, run);
      expect(convertRunClosedBeforeCaret(view, run)).toBe(true);
      expect(save()).toBe(saved);
    }
  });

  it("doesn't convert a closing run the commit didn't end with", async () => {
    const { view } = await openView();
    caretToEndOfFirstBlock(view);
    commit(view, "**粘贴**");
    expect(convertRunClosedBeforeCaret(view, "你好")).toBe(false);
  });

  it("runs on its own after compositionend", async () => {
    const { view, save } = await openView();
    caretToEndOfFirstBlock(view);
    commit(view, "**加粗文本**");
    vi.useFakeTimers();
    try {
      view.dom.dispatchEvent(
        new CompositionEvent("compositionend", { data: "*" }),
      );
      vi.advanceTimersByTime(COMPOSE_RELOCATE_DELAY_MS + 10);
    } finally {
      vi.useRealTimers();
    }
    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe("md_span");
    expect(save()).toBe("**加粗文本**\n");
  });
});

describe("Close formatting marks automatically (#136)", () => {
  it("on, opens a shell with its closing mark as soon as * is typed", async () => {
    const { view, save } = await openView();
    caretToEndOfFirstBlock(view);
    type(view, "**");
    const shell = view.state.doc.firstChild?.firstChild;
    expect(shell?.type.name).toBe("md_span");
    expect(shell?.attrs.rung).toBe(2);
    type(view, "bold**after");
    expect(save()).toBe("**bold**after\n");
  });

  it("off, leaves * and ** as typed, with no closing mark", async () => {
    const { view } = await openView("", { autoCloseMarks: false });
    caretToEndOfFirstBlock(view);
    type(view, "**~~==`");
    const paragraph = view.state.doc.firstChild!;
    expect(paragraph.childCount).toBe(1);
    expect(paragraph.firstChild?.isText).toBe(true);
    expect(paragraph.textContent).toBe("**~~==`");
  });

  it("off, still turns a hand-typed **text** into bold", async () => {
    const { view, save } = await openView("", { autoCloseMarks: false });
    caretToEndOfFirstBlock(view);
    type(view, "**bold**");
    const node = view.state.doc.firstChild?.firstChild;
    expect(node?.type.name).toBe("md_span");
    expect(node?.attrs.rung).toBe(2);
    type(view, " *it* ~~s~~ ==h== `c` after");
    expect(save()).toBe("**bold** *it* ~~s~~ ==h== `c` after\n");
  });

  it("off, still converts a span committed by an IME", async () => {
    const { view, save } = await openView("", { autoCloseMarks: false });
    caretToEndOfFirstBlock(view);
    for (const piece of ["*", "*", "加粗文本", "*", "*"]) {
      commit(view, piece);
      convertRunClosedBeforeCaret(view, piece);
    }
    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe("md_span");
    expect(save()).toBe("**加粗文本**\n");
  });

  it("off, still turns hand-typed bold around code into bold", async () => {
    const { view, save } = await openView("", { autoCloseMarks: false });
    caretToEndOfFirstBlock(view);
    type(view, "**a `b` c** and *`d`*");
    expect(save()).toBe("**a `b` c** and *`d`*\n");
  });

  it("off, still turns ``` and Enter into a code block", async () => {
    const { view, save } = await openView("", { autoCloseMarks: false });
    caretToEndOfFirstBlock(view);
    type(view, "```");
    view.someProp("handleKeyDown", (f) =>
      f(view, new KeyboardEvent("keydown", { key: "Enter" })),
    );
    expect(view.state.doc.firstChild?.type.name).toBe("code_block");
    expect(save()).toBe("```\n```\n");
  });
});

describe("code inside bold, italic, strikethrough and highlight", () => {
  it.each([
    "**a `b` c**",
    "*a `b` c*",
    "***a `b` c***",
    "~~a `b` c~~",
    "==a `b` c==",
    "**`b`**",
    "**中文`代码`**后",
  ])("types %s with code in it", async (typed) => {
    const { view, save } = await openView();
    caretToEndOfFirstBlock(view);
    type(view, typed);
    expect(save()).toBe(`${typed}\n`);
  });

  it.each([
    ["**a `b`**", "**"],
    ["**`b`**", "**"],
    ["*a $x$*", "*"],
    ["~~a `b`~~", "~~"],
  ])(
    "brings %s back when its deleted closer is retyped",
    async (markdown, closer) => {
      const { view, save } = await openView(`${markdown}\n`);
      caretToEndOfFirstBlock(view);
      view.someProp("handleKeyDown", (f) =>
        f(view, new KeyboardEvent("keydown", { key: "Backspace" })),
      );
      expect(save()).not.toBe(`${markdown}\n`);
      type(view, closer);
      expect(save()).toBe(`${markdown}\n`);
    },
  );

  it("turns ** typed in front of text and code with ** after it into bold", async () => {
    const { view, save } = await openView("x a `b`** y\n");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
    );
    type(view, "**");
    expect(save()).toBe("x **a `b`** y\n");
  });

  it("converts bold around code committed by an IME", async () => {
    const { view, save } = await openView("**加粗`代码`\n");
    caretToEndOfFirstBlock(view);
    for (const piece of ["*", "*"]) {
      commit(view, piece);
      convertRunClosedBeforeCaret(view, piece);
    }
    expect(save()).toBe("**加粗`代码`**\n");
  });

  it("moves IME text pulled into the code beside the caret back out into the bold", async () => {
    // WebKit can draw the caret after the code as inside it, and the
    // composition lands in the code.
    const { view, save } = await openView("**a `b`**\n");
    const afterCode = 7; // in the bold, after "a " and the code
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, afterCode),
      ),
    );
    vi.useFakeTimers();
    try {
      view.dom.dispatchEvent(new CompositionEvent("compositionstart"));
      const tr = view.state.tr.insertText("代码", afterCode - 1);
      view.dispatch(
        tr.setSelection(TextSelection.create(tr.doc, afterCode + 1)),
      );
      view.dom.dispatchEvent(
        new CompositionEvent("compositionend", { data: "代码" }),
      );
      vi.advanceTimersByTime(COMPOSE_RELOCATE_DELAY_MS + 20);
    } finally {
      vi.useRealTimers();
    }
    expect(save()).toBe("**a `b`代码**\n");
  });

  it("keeps the code's text and the link on it in the new bold", async () => {
    const { view, save } = await openView("**see [it `x`](u)\n");
    caretToEndOfFirstBlock(view);
    type(view, "**");
    expect(save()).toBe("**see [it `x`](u)**\n");
  });
});

describe("italic typed with underscores", () => {
  it("turns _italic_ into italic, saved with its underscores", async () => {
    const { view, save } = await openView();
    caretToEndOfFirstBlock(view);
    type(view, "an _italic_ word");
    const span = view.state.doc.firstChild!.child(1);
    expect(span.type.name).toBe("md_span");
    expect(span.attrs).toEqual({ delim: "_", rung: 1 });
    expect(save()).toBe("an _italic_ word\n");
  });

  it.each(["snake_case_name", "file_name_v2 and a_b_", "_ spaced _", "__"])(
    "leaves %s as text",
    async (typed) => {
      const { view } = await openView();
      caretToEndOfFirstBlock(view);
      type(view, typed);
      const paragraph = view.state.doc.firstChild!;
      expect(paragraph.childCount).toBe(1);
      expect(paragraph.firstChild!.text).toBe(typed);
    },
  );

  it("saves snake_case without escapes", async () => {
    const { view, save } = await openView();
    caretToEndOfFirstBlock(view);
    type(view, "snake_case and file_name_v2");
    expect(save()).toBe("snake_case and file_name_v2\n");
  });

  it("doesn't close right before a letter", async () => {
    const { view } = await openView("_ab\n");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
    );
    type(view, "_");
    expect(view.state.doc.firstChild!.childCount).toBe(1);
    expect(view.state.doc.firstChild!.textContent).toBe("_a_b");
  });

  it("saves with asterisks once a word is typed against it", async () => {
    const { view, save } = await openView();
    caretToEndOfFirstBlock(view);
    type(view, "_it_s");
    expect(save()).toBe("*it*s\n");
  });

  it("is read back as underscores, and kept when its paragraph is edited", async () => {
    const { view, save } = await openView("an _old_ one\n");
    expect(view.state.doc.firstChild!.child(1).attrs.delim).toBe("_");
    caretToEndOfFirstBlock(view);
    type(view, " more");
    expect(save()).toBe("an _old_ one more\n");
  });

  it("converts one committed by an IME", async () => {
    const { view, save } = await openView("前");
    caretToEndOfFirstBlock(view);
    commit(view, " _斜体_");
    expect(convertRunClosedBeforeCaret(view, "_斜体_")).toBe(true);
    expect(save()).toBe("前 _斜体_\n");
  });

  it("works with Close formatting marks automatically off", async () => {
    const { view, save } = await openView("", { autoCloseMarks: false });
    caretToEndOfFirstBlock(view);
    type(view, "_it_");
    expect(save()).toBe("_it_\n");
  });
});
