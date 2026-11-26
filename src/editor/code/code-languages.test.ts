// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import { addCodeLanguage, addedLanguageNames } from "./code-languages";
import { pickerLanguages } from "./code-block-language-view";
import { fenceLanguage } from "../modes/source-languages";

// A language a plugin adds: coloured in the editor once its grammar is
// read, by any of its names, and offered in the language menu.

const undo: (() => void)[] = [];
afterEach(async () => {
  undo.splice(0).forEach((f) => f());
  await closeViews();
});

const GRAMMAR = JSON.stringify({
  flags: "i",
  rules: [
    { token: "comment", match: "^\\s*!.*" },
    { token: "keyword", match: "\\b(?:interface|shutdown)\\b" },
  ],
});

function addCisco(load = vi.fn(async () => GRAMMAR)) {
  undo.push(
    addCodeLanguage({ id: "cisco", aliases: ["IOS", "cisco-ios"], load }),
  );
  return load;
}

const tokens = (dom: HTMLElement) =>
  [...dom.querySelectorAll("code .token")].map((el) => [
    el.textContent,
    el.className,
  ]);

it("colours a block in a plugin's language by any of its names, reading the grammar once", async () => {
  const load = addCisco();
  const t = await openView(
    "```IOS\n! core\ninterface Gi0/1\n shutdown\n```\n\n```cisco-ios\nINTERFACE x\n```",
  );
  await vi.waitFor(() => expect(tokens(t.view.dom)).toHaveLength(4));
  expect(tokens(t.view.dom)).toEqual([
    ["! core", "token comment"],
    ["interface", "token keyword"],
    ["shutdown", "token keyword"],
    ["INTERFACE", "token keyword"],
  ]);
  expect(load).toHaveBeenCalledTimes(1);
});

it("leaves every block of a language plain once one takes too long", async () => {
  addCisco();
  const t = await openView(
    "```cisco\ninterface a\n```\n\n```ios\nshutdown\n```",
  );
  await vi.waitFor(() => expect(tokens(t.view.dom)).toHaveLength(2));
  // The next reading of a line takes a second.
  let clock = 0;
  const now = vi
    .spyOn(performance, "now")
    .mockImplementation(() => (clock += 1000));
  t.caretAt("interface");
  t.type("x");
  now.mockRestore();
  await vi.waitFor(() => expect(tokens(t.view.dom)).toEqual([]));
  expect(fenceLanguage("cisco")).not.toBeNull();
});

it("reads no grammar for a document without the language, and leaves Textus's own languages to refractor", async () => {
  const load = addCisco();
  undo.push(
    addCodeLanguage({ id: "python", aliases: [], load: async () => GRAMMAR }),
  );
  const t = await openView("```python\nimport os\n```\n\ntext");
  expect(load).not.toHaveBeenCalled();
  expect(tokens(t.view.dom)).toContainEqual(["import", "token keyword"]);
});

it("is offered in the language menu and to source mode while it is added", async () => {
  addCisco();
  expect(pickerLanguages(addedLanguageNames())).toContain("cisco");
  expect(fenceLanguage("Cisco-IOS")?.name).toBe("cisco");
  expect(fenceLanguage("js")?.name).toBe("JavaScript");
  // A plugin's name holding one of CodeMirror's ("tex" in "bibtex") is
  // the plugin's.
  undo.push(
    addCodeLanguage({ id: "bibtex", aliases: [], load: async () => GRAMMAR }),
  );
  expect(fenceLanguage("bibtex")?.name).toBe("bibtex");
  expect(fenceLanguage("python title=x")?.name).toBe("Python");
  undo.splice(0).forEach((f) => f());
  expect(pickerLanguages(addedLanguageNames())).not.toContain("cisco");
  expect(fenceLanguage("cisco")).toBeNull();
});
