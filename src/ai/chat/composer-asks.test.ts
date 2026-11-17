import { expect, it } from "vitest";
import { askInComposer, takeComposerAsks } from "./composer-asks";

it("gives an ask to the composer on screen, not the last one mounted", () => {
  const got: string[] = [];
  const front = takeComposerAsks(
    (text) => got.push(`front:${text}`),
    () => true,
  );
  // A tab opened later, then put behind: kept loaded, not shown.
  const behind = takeComposerAsks(
    (text) => got.push(`behind:${text}`),
    () => false,
  );
  void askInComposer("Ask about it");
  expect(got).toEqual(["front:Ask about it"]);
  front();
  behind();
});

it("says when an ask was taken, however long its composer takes to come up", async () => {
  const order: string[] = [];
  const asked = askInComposer("Edit with AI").then(() => order.push("taken"));
  // The panel still opening: nobody has it yet.
  await Promise.resolve();
  expect(order).toEqual([]);
  const stop = takeComposerAsks((text) => order.push(text));
  await asked;
  expect(order).toEqual(["Edit with AI", "taken"]);
  // With a composer up, at once.
  await askInComposer("again").then(() => order.push("taken"));
  expect(order.slice(2)).toEqual(["again", "taken"]);
  stop();
});
