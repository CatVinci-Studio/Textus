import { afterEach, expect, it } from "vitest";
import {
  addDecorationProvider,
  decorate,
  removeDecorationProvider,
} from "./decorations";
import type { SentBlock } from "../../editor/markdown/doc-blocks";

afterEach(() => removeDecorationProvider("numbers"));

it("asks with the asking editor's whole document, not the one in front", async () => {
  const doc: SentBlock[] = [
    { id: "a", kind: "heading", markdown: "# One" },
    { id: "b", kind: "heading", markdown: "# Two" },
  ];
  addDecorationProvider("numbers", async (inSight, all) =>
    inSight.map((b) => ({
      block: b.id,
      style: "badge" as const,
      text: String(all.indexOf(b) + 1),
    })),
  );
  const marks = await decorate([doc[1]], doc);
  expect(marks).toEqual([
    { block: "b", style: "badge", text: "2", plugin: "numbers" },
  ]);
});
