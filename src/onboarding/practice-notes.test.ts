// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { createTestEditor } from "../document-view/editor-test-harness";
import { LANGS } from "../i18n/strings";
import { evaluateWysiwyg } from "./tutorial-evaluation";
import { practiceNotes, withPracticeNotes } from "./practice-notes";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

describe.each(LANGS)("the practice notes in %s", (lang) => {
  const notes = practiceNotes(lang);

  it("quote the classic, then give the learner's notes under a heading", () => {
    expect(notes.body.match(/^## /gm)).toHaveLength(2);
    expect(notes.body).toMatch(/^> /m);
    // The notes come last: the AI lessons add to and rework them there.
    expect(notes.body.trimEnd().split("\n").at(-1)).not.toMatch(/^[>#]/);
    // Nothing the writing lessons ask the learner to add.
    expect(evaluateWysiwyg(notes.body)).toBe(0);
  });

  it("come back from the editor exactly as written", async () => {
    // The lessons compare the document with the notes line by line.
    const editor = await createTestEditor(notes.body);
    editors.push(editor);
    const saved = await editor.action((ctx) =>
      ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
    );
    expect(saved).toBe(notes.body);
  });
});

describe("the practice notes", () => {
  it("are their own in every language", () => {
    const titles = new Set(LANGS.map((lang) => practiceNotes(lang).title));
    expect(titles.size).toBe(LANGS.length);
  });

  it("go under what the learner wrote, with their title only if empty", () => {
    const notes = practiceNotes("en");
    const mine = "# Notes on Hamlet\n\n- Hamlet\n";
    expect(withPracticeNotes(mine, notes)).toBe(
      `# Notes on Hamlet\n\n- Hamlet\n\n${notes.body}`,
    );
    expect(withPracticeNotes("  \n", notes)).toBe(
      `# Notes on Hamlet\n\n${notes.body}`,
    );
  });

  it("are never added twice, whatever language they went in as", () => {
    const en = withPracticeNotes("", practiceNotes("en"));
    expect(withPracticeNotes(en, practiceNotes("en"))).toBe(en);
    expect(withPracticeNotes(en, practiceNotes("zh"))).toBe(en);
    const zh = withPracticeNotes("", practiceNotes("zh"));
    expect(withPracticeNotes(zh, practiceNotes("ja"))).toBe(zh);
  });
});
