// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  addCodeBlockLanguage,
  codeBlockAtInterfaceSize,
  codeBlockFrameless,
  codeBlockPlugin,
  onCodeBlockLanguages,
} from "./code-blocks";
import {
  addHoverProvider,
  provideHover,
  removeHoverProvider,
} from "./hover-providers";
import { claim, ownerOf, ownedClaims } from "./owners";
import type { Contributes } from "../store/manifest";
import { publish, type PluginRecord } from "../store/plugin-records";
import {
  customEditorFor,
  customEditorForContent,
  frontMatterKeys,
} from "../store/plugin-lookup";

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  removeHoverProvider("a.cards");
  removeHoverProvider("b.cards");
  removeHoverProvider("c.cards");
});

it("lets the first plugin draw a language, and hands it over when it goes", () => {
  let redraws = 0;
  undo.push(onCodeBlockLanguages(() => redraws++));
  const offA = addCodeBlockLanguage("Chart", "a.chart", "none", "interface");
  undo.push(addCodeBlockLanguage("chart", "b.chart"));
  expect(codeBlockPlugin("chart")).toBe("a.chart");
  expect(codeBlockFrameless("chart")).toBe(true);
  expect(codeBlockAtInterfaceSize("chart")).toBe(true);
  offA();
  expect(codeBlockPlugin("CHART")).toBe("b.chart");
  expect(codeBlockFrameless("chart")).toBe(false);
  expect(codeBlockAtInterfaceSize("chart")).toBe(false);
  expect(redraws).toBe(3);
});

it("goes to the first claimant, the next taking over as it goes", () => {
  undo.push(claim("editor:*.pdf", "a.pdf"), claim("editor:*.pdf", "b.pdf"));
  expect(ownerOf("editor:*.pdf")).toBe("a.pdf");
  undo.splice(0, 1)[0]();
  expect(ownerOf("editor:*.pdf")).toBe("b.pdf");
});

it("asks only the owner of a declared hover kind; others for the rest", async () => {
  const card = (title: string) => async () => ({ title, markdown: "" });
  addHoverProvider("a.cards", card("A"), true);
  addHoverProvider("b.cards", card("B"), true);
  addHoverProvider("c.cards", card("C"));
  undo.push(claim("hover:document", "a.cards"));
  const offB = claim("hover:document", "b.cards");
  const doc = { type: "document", path: "/n.md", heading: null } as const;
  expect((await provideHover(doc))?.title).toBe("A");
  expect((await provideHover({ type: "link", url: "x" }))?.title).toBe("C");
  undo.splice(0, 1)[0]();
  expect((await provideHover(doc))?.title).toBe("B");
  offB();
  expect((await provideHover(doc))?.title).toBe("C");
});

it("reads the claims of default editors and declared hovers", () => {
  const contributes = {
    customEditors: [
      { priority: "default", filenamePatterns: ["*.PDF"], frontMatter: [] },
      { priority: "option", filenamePatterns: ["*.txt"], frontMatter: [] },
      {
        priority: "default",
        filenamePatterns: [],
        frontMatter: ["kanban-plugin"],
      },
    ],
    hovers: ["citation"],
  } as unknown as Contributes;
  expect(ownedClaims(contributes)).toEqual([
    "editor:*.pdf",
    "editor:front-matter:kanban-plugin",
    "hover:citation",
  ]);
});

it("opens a file with the owner of its pattern", () => {
  const record = (id: string) =>
    ({
      id,
      status: "on",
      manifest: {
        contributes: {
          customEditors: [
            {
              viewType: "view",
              priority: "default",
              filenamePatterns: ["*.pdf"],
            },
          ],
        },
      },
    }) as unknown as PluginRecord;
  publish({ allOn: true, records: [record("a.pdf"), record("b.pdf")] });
  undo.push(claim("editor:*.pdf", "a.pdf"), claim("editor:*.pdf", "b.pdf"));
  expect(customEditorFor("/x/y.pdf")?.plugin).toBe("a.pdf");
  publish({ records: [] });
});

it("opens a Markdown document whose front matter a plugin claims, by its owner", () => {
  const record = (id: string) =>
    ({
      id,
      status: "on",
      manifest: {
        contributes: {
          customEditors: [
            {
              viewType: "board",
              priority: "default",
              filenamePatterns: [],
              frontMatter: ["kanban-plugin"],
            },
          ],
        },
      },
    }) as unknown as PluginRecord;
  publish({ allOn: true, records: [record("a.board"), record("b.board")] });
  const key = "editor:front-matter:kanban-plugin";
  undo.push(claim(key, "a.board"), claim(key, "b.board"));
  const board = "---\nkanban-plugin: board\n---\n\n## Todo\n";
  expect(customEditorForContent("/x/Plan.md", board)?.plugin).toBe("a.board");
  // Not in its front matter, or not Markdown: a document.
  expect(customEditorForContent("/x/Plan.md", "kanban-plugin: board\n")).toBe(
    null,
  );
  expect(customEditorForContent("/x/Plan.txt", board)).toBe(null);
  expect(frontMatterKeys("---\ntitle: A\nkanban-plugin: board\n---\n")).toEqual(
    ["title", "kanban-plugin"],
  );
  publish({ records: [] });
});

it("draws an embed kind by its owner in the one registry", async () => {
  const { setPluginEmbed, forgetEmbeds } = await import("./embeds");
  const { embedProvider } = await import("../../editor/extension-points");
  const ask = async () => null;
  setPluginEmbed("a.links", "notes", ["note"], ask);
  setPluginEmbed("b.links", "notes", ["note"], ask);
  undo.push(
    () => forgetEmbeds("a.links"),
    () => forgetEmbeds("b.links"),
  );
  expect(embedProvider("note")?.owner).toBe("a.links");
  forgetEmbeds("b.links");
  expect(embedProvider("note")?.owner).toBe("a.links");
});
