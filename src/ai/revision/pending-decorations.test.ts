// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Editor } from "@milkdown/kit/core";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { buildDecorations } from "./pending-decorations";
import {
  animations,
  newAnimation,
  releaseView,
  streamPendingInsertText,
  textKey,
} from "./pending-animation";
import { usePendingEdits } from "./usePendingEdits";
import { forgetReveals } from "./kept-reveals";
import { setWindowTabs } from "../../engine/layout/store";
import type { PendingPreview } from "./pending-types";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  animations.clear();
  setWindowTabs(() => []);
});

const hooks = {
  labels: () => ({ take: "Accept", keep: "Keep" }),
  decide: () => {},
  focused: () => null,
};

/** The widgets' keys: what each decoration draws. */
function widgetKeys(set: ReturnType<typeof buildDecorations>): string[] {
  return set
    .find()
    .map((d) => (d.spec as { key?: string }).key ?? "")
    .filter(Boolean);
}

describe("a rewrite streamed sentence by sentence", () => {
  it("settled without sentences, is drawn whole, not as its stream", async () => {
    editor = await createTestEditor("第一句。第二句。\n");
    const doc = editor.action((ctx) => ctx.get(editorViewCtx).state.doc);
    const base: PendingPreview = {
      callId: "c1",
      proposal: {
        action: "replace",
        anchor: "第一句。第二句。",
        text: "## 新标题\n\n- 第一句改。\n- 第二句改。",
      },
      from: 0,
      to: doc.content.size,
      expectedText: doc.textBetween(0, doc.content.size, " "),
      replacement: "## 新标题\n\n- 第一句改。\n- 第二句改。",
      streamSource: {
        sentences: ["第一句。", "第二句。"],
        ranges: [
          { from: 1, to: 5 },
          { from: 5, to: 9 },
        ],
      },
    };
    // Streaming, it is laid out sentence by sentence.
    buildDecorations(doc, [{ ...base, streaming: true }], true, hooks);
    expect(animations.get("c1")?.stream).toBeTruthy();
    // Settled, its changes weren't found (no sentences): one change, drawn
    // whole as its blocks, as the review bar and Accept take it.
    const keys = widgetKeys(buildDecorations(doc, [base], true, hooks));
    expect(keys.some((k) => k.startsWith("pending-insert-c1"))).toBe(true);
    expect(keys.some((k) => k.startsWith("pending-new-"))).toBe(false);
  });

  it("new text that is blocks goes after the block it lands in, as blocks", async () => {
    editor = await createTestEditor("- 甲。\n- 乙。\n\n后文。\n");
    const doc = editor.action((ctx) => ctx.get(editorViewCtx).state.doc);
    const list = doc.child(0);
    let from = 0;
    let to = 0;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === "甲。") [from, to] = [pos, pos + 3];
      if (node.isText && node.text === "乙。") to = pos + 3;
    });
    const after = "- 甲改。\n- 乙改。\n\n";
    const preview: PendingPreview = {
      callId: "c2",
      proposal: { action: "replace", anchor: "- 甲。\n- 乙。", text: after },
      from: 0,
      to: list.nodeSize,
      expectedText: doc.textBetween(0, list.nodeSize, " "),
      replacement: after,
      sentences: {
        hunks: [{ kind: "change", before: "- 甲。\n- 乙。\n\n", after }],
        changes: [
          { from, to, before: "- 甲。\n- 乙。\n\n", after, take: null },
        ],
      },
    };
    const set = buildDecorations(doc, [preview], true, hooks);
    const added = set
      .find()
      .filter((d) =>
        (d.spec as { key?: string }).key?.startsWith("pending-new-"),
      );
    expect(added).toHaveLength(1);
    // After the list, not inside its last item, where `- ` showed as text.
    expect(added[0].from).toBe(list.nodeSize);
  });

  it("a list item rewritten alone stays in its line, without its marker", async () => {
    editor = await createTestEditor("- 甲。\n- 乙。\n- 丙。\n");
    const doc = editor.action((ctx) => ctx.get(editorViewCtx).state.doc);
    let from = 0;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === "乙。") from = pos;
    });
    const preview: PendingPreview = {
      callId: "c3",
      proposal: { action: "replace", anchor: "- 乙。", text: "- 乙改了。" },
      from: 0,
      to: doc.content.size,
      expectedText: doc.textBetween(0, doc.content.size, " "),
      replacement: "- 甲。\n- 乙改了。\n- 丙。",
      sentences: {
        hunks: [{ kind: "change", before: "- 乙。\n", after: "- 乙改了。\n" }],
        changes: [
          {
            from,
            to: from + 2,
            before: "- 乙。\n",
            after: "- 乙改了。\n",
            take: null,
          },
        ],
      },
    };
    const added = buildDecorations(doc, [preview], true, hooks)
      .find()
      .filter((d) =>
        (d.spec as { key?: string }).key?.startsWith("pending-new-"),
      );
    expect(added).toHaveLength(1);
    expect(added[0].from).toBe(from + 2);
    // Drawn as "乙改了。", not "- 乙改了。".
    expect((added[0].spec as { key: string }).key).toMatch(
      new RegExp(`-${textKey("乙改了。")}$`),
    );
  });

  /** One change of `old` in `markdown`, `before` -> `after`: where its new
   *  text is drawn, and what it draws. */
  async function drawnChange(
    markdown: string,
    old: string,
    before: string,
    after: string,
  ) {
    editor = await createTestEditor(markdown);
    const doc = editor.action((ctx) => ctx.get(editorViewCtx).state.doc);
    let from = 0;
    doc.descendants((node, pos) => {
      const at = node.isText ? (node.text ?? "").indexOf(old) : -1;
      if (at >= 0) from = pos + at;
    });
    const to = from + old.length;
    const preview: PendingPreview = {
      callId: "c4",
      proposal: { action: "replace", anchor: before.trim(), text: after },
      from: 0,
      to: doc.content.size,
      expectedText: doc.textBetween(0, doc.content.size, " "),
      replacement: after,
      sentences: {
        hunks: [{ kind: "change", before, after }],
        changes: [{ from, to, before, after, take: null }],
      },
    };
    const added = buildDecorations(doc, [preview], true, hooks)
      .find()
      .filter((d) =>
        (d.spec as { key?: string }).key?.startsWith("pending-new-"),
      );
    expect(added).toHaveLength(1);
    const key = (added[0].spec as { key: string }).key;
    return { doc, to, at: added[0].from, key };
  }

  it("a sentence a number starts stays a sentence in its paragraph", async () => {
    const { to, at, key } = await drawnChange(
      "第一句。第二句。\n",
      "第二句。",
      "第二句。",
      "1984. 那年。",
    );
    // In its line, not a list of its own after the paragraph.
    expect(at).toBe(to);
    expect(key).toMatch(new RegExp(`-${textKey("1984. 那年。")}$`));
  });

  it("a list item rewritten as a numbered one keeps its number, after the list", async () => {
    const { doc, at, key } = await drawnChange(
      "- 甲。\n- 乙。\n",
      "乙。",
      "- 乙。\n",
      "2023. 年份变了。\n",
    );
    expect(at).toBe(doc.child(0).nodeSize);
    expect(key).toMatch(new RegExp(`-${textKey("2023. 年份变了。")}$`));
  });

  it("a numbered heading or quote line rewritten stays in its line, its number kept", async () => {
    let drawn = await drawnChange(
      "## 1. 引言\n",
      "1. 引言",
      "## 1. 引言",
      "## 1. 背景",
    );
    expect(drawn.at).toBe(drawn.to);
    expect(drawn.key).toMatch(new RegExp(`-${textKey("1. 背景")}$`));
    editor?.destroy();
    drawn = await drawnChange("> 甲。\n", "甲。", "> 甲。", "> 1984. 年。");
    expect(drawn.at).toBe(drawn.to);
    expect(drawn.key).toMatch(new RegExp(`-${textKey("1984. 年。")}$`));
  });
});

/** A macrotask between editors, so jsdom lets the last one go. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a proposal's reveal lets go", () => {
  it("of an editor that goes, its proposals still undecided", async () => {
    for (let i = 0; i < 4; i++) {
      editor = await createTestEditor("甲。\n", {}, { ai: true });
      const view = editor.action((ctx) => ctx.get(editorViewCtx));
      const anim = newAnimation(`c${i}`, "乙。", true);
      anim.view = view;
      anim.span = document.createElement("span");
      animations.set(anim.callId, anim);
      editor.destroy();
      editor = null;
      await tick();
    }
    expect(animations.size).toBe(0);
  });

  it("keeps what an open document offers again, until it closes", () => {
    const keep = (id: string) => {
      const view = {} as EditorView;
      const anim = newAnimation(id, "乙。", true);
      anim.view = view;
      animations.set(id, anim);
      releaseView(view, [{ callId: id }], "/a.md");
    };
    setWindowTabs(() => [{ id: "t", path: "/a.md" }]);
    keep("k");
    expect(animations.get("k")?.view).toBeNull();
    // Not offered again by its next editor: it goes as that one does.
    releaseView({} as EditorView, [], "/a.md");
    expect(animations.has("k")).toBe(false);
    keep("k2");
    // Still streaming: it starts over, its text coming in anew.
    releaseView(
      {} as EditorView,
      [{ callId: "k2" }, { callId: "s", streaming: true }],
      "/a.md",
    );
    streamPendingInsertText("s", "丙。", false);
    forgetReveals("/a.md");
    expect(animations.has("k2")).toBe(false);
    expect(animations.has("s")).toBe(false);
  });

  it("of streamed text that never reached the list", async () => {
    editor = await createTestEditor("甲。\n");
    const e = editor;
    const run = <T>(fn: (ctx: Ctx) => T) => e.action(fn);
    const hook = renderHook(() => usePendingEdits(run));
    streamPendingInsertText("gone", "乙。", true);
    act(() => hook.result.current.discard("gone"));
    expect(animations.has("gone")).toBe(false);
    streamPendingInsertText("lost", "乙。", true);
    act(() =>
      hook.result.current.showPreviews(
        [
          {
            callId: "lost",
            proposal: { action: "replace", anchor: "没有这句。", text: "乙。" },
          },
        ],
        null,
      ),
    );
    expect(animations.has("lost")).toBe(false);
  });
});
