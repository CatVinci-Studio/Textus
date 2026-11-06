import { afterEach, expect, it } from "vitest";
import {
  addCodeBlockLanguage,
  codeBlockFrameless,
  codeBlockPlugin,
  onCodeBlockLanguages,
} from "./code-blocks";
import {
  addHoverProvider,
  provideHover,
  removeHoverProvider,
} from "./hover-providers";
import { claim, claimantsOf, ownerOf, ownedClaims, pickOwner } from "./owners";
import type { Contributes } from "../store/manifest";
import { publish, type PluginRecord } from "../store/plugin-records";
import { customEditorFor } from "../store/plugin-lookup";

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
  const offA = addCodeBlockLanguage("Chart", "a.chart", "none");
  undo.push(addCodeBlockLanguage("chart", "b.chart"));
  expect(codeBlockPlugin("chart")).toBe("a.chart");
  expect(codeBlockFrameless("chart")).toBe(true);
  offA();
  expect(codeBlockPlugin("CHART")).toBe("b.chart");
  expect(codeBlockFrameless("chart")).toBe(false);
  expect(redraws).toBe(3);
});

it("keeps the user's pick while that plugin is on", () => {
  undo.push(claim("editor:*.pdf", "a.pdf"), claim("editor:*.pdf", "b.pdf"));
  pickOwner("editor:*.pdf", "b.pdf");
  expect(ownerOf("editor:*.pdf")).toBe("b.pdf");
  expect(claimantsOf("editor:*.pdf")).toEqual(["a.pdf", "b.pdf"]);
  undo.splice(1, 1)[0]();
  expect(ownerOf("editor:*.pdf")).toBe("a.pdf");
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
      { priority: "default", filenamePatterns: ["*.PDF"] },
      { priority: "option", filenamePatterns: ["*.txt"] },
    ],
    hovers: ["citation"],
  } as unknown as Contributes;
  expect(ownedClaims(contributes)).toEqual(["editor:*.pdf", "hover:citation"]);
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
  pickOwner("editor:*.pdf", "b.pdf");
  expect(customEditorFor("/x/y.pdf")?.plugin).toBe("b.pdf");
  publish({ records: [] });
});
