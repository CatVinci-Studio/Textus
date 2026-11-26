// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import {
  buildStandaloneHtml,
  cloneEditorContent,
} from "../../export/standalone-html";
import type { Settings } from "../../prefs/settings-types";
import { fs } from "../../platform/ipc";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import {
  LINE_BREAKS_ATTR,
  folderLineBreaks,
  lineBreaksPlugin,
  showsLineBreaks,
} from "./line-breaks-plugin";

afterEach(closeViews);
afterEach(() => vi.restoreAllMocks());

const SOURCE = "one\ntwo\n\nthree";
const SOFT_BREAK = '[data-type="hardbreak"][data-is-inline="true"]';

describe("one newline in a paragraph", () => {
  it("joins the lines by default, the text kept", async () => {
    const t = await openView(SOURCE);
    expect(t.view.dom.hasAttribute(LINE_BREAKS_ATTR)).toBe(false);
    expect(t.view.dom.querySelector(SOFT_BREAK)).not.toBeNull();
    expect(t.markdown()).toBe(SOURCE);
  });

  it("breaks the line where the setting says, the text kept", async () => {
    const t = await openView(SOURCE, { singleNewline: "break" });
    expect(t.view.dom.hasAttribute(LINE_BREAKS_ATTR)).toBe(true);
    expect(t.view.dom.querySelectorAll("br")).toHaveLength(0);
    expect(t.markdown()).toBe(SOURCE);
  });

  it("carries the breaks into an HTML or PDF export of the editor", async () => {
    const page = async (settings: Partial<Settings>) => {
      const t = await openView(SOURCE, settings);
      const html = buildStandaloneHtml(
        "doc",
        cloneEditorContent(t.view.dom),
        "",
      );
      const doc = new DOMParser().parseFromString(html, "text/html");
      return doc.querySelectorAll(`[${LINE_BREAKS_ATTR}] ${SOFT_BREAK}`).length;
    };
    expect(await page({ singleNewline: "break" })).toBe(1);
    expect(await page({})).toBe(0);
  });

  it("goes by the folder's own convention first", async () => {
    expect(showsLineBreaks(true, "join")).toBe(true);
    expect(showsLineBreaks(false, "break")).toBe(false);
    expect(showsLineBreaks(null, "break")).toBe(true);
    expect(showsLineBreaks(null, "join")).toBe(false);
    vi.spyOn(fs, "folderConventions").mockResolvedValue({
      softBreaks: { value: true, app: "obsidian", root: "/v" },
    } as Awaited<ReturnType<typeof fs.folderConventions>>);
    expect(await folderLineBreaks("/v/a.md")).toBe(true);
    expect(await folderLineBreaks(null)).toBe(null);
    vi.spyOn(fs, "folderConventions").mockRejectedValue(new Error("none"));
    expect(await folderLineBreaks("/v/a.md")).toBe(null);
  });

  it("reads the folder again when the document moves to another", async () => {
    const vault = (path: string) =>
      ({
        softBreaks: path.startsWith("/v/")
          ? { value: true, app: "obsidian", root: "/v" }
          : null,
      }) as Awaited<ReturnType<typeof fs.folderConventions>>;
    vi.spyOn(fs, "folderConventions").mockImplementation((path) =>
      Promise.resolve(vault(path)),
    );
    let docPath: string | null = "/v/a.md";
    const schema = new Schema({
      nodes: { doc: { content: "text*" }, text: {} },
    });
    const view = new EditorView(document.createElement("div"), {
      state: EditorState.create({
        schema,
        plugins: [
          lineBreaksPlugin({ setting: () => "join", docPath: () => docPath }),
        ],
      }),
    });
    const settle = () => new Promise((done) => setTimeout(done));
    const breaks = () => view.dom.hasAttribute(LINE_BREAKS_ATTR);
    await settle();
    expect(breaks()).toBe(true);
    // Saved as into a folder that says nothing: the setting again.
    docPath = "/elsewhere/a.md";
    view.dispatch(view.state.tr.insertText("x"));
    await settle();
    expect(breaks()).toBe(false);
    view.destroy();
  });
});
