import { expect, it } from "vitest";
import { askInComposer, takeComposerAsks } from "./composer-asks";

it("gives an ask to the composer on screen, not the last one mounted", () => {
  const got: string[] = [];
  const front = takeComposerAsks((text) => got.push(`front:${text}`), () => true);
  // A tab opened later, then put behind: kept loaded, not shown.
  const behind = takeComposerAsks((text) => got.push(`behind:${text}`), () => false);
  askInComposer("Ask about it");
  expect(got).toEqual(["front:Ask about it"]);
  front();
  behind();
});
