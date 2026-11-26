// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import {
  addCompletionSource,
  type CompletionContext,
  type CompletionSource,
  type PanelItem,
} from "./sources";

// A plugin's completions for code (`where: "code"`): asked in a code block,
// with its language; the text's and formulas' never are.

const removers: (() => void)[] = [];
afterEach(async () => {
  removers.splice(0).forEach((remove) => remove());
  await closeViews();
});

const source = (where: CompletionSource["where"]) => {
  const provide = vi.fn<(context: CompletionContext) => PanelItem[]>(() => [
    { label: "print", insert: "print($0)" },
  ]);
  removers.push(
    addCompletionSource({
      id: `test.${where}`,
      owner: "test",
      where,
      pattern: /\b[a-z]{2,}$/u,
      title: () => where,
      provide,
    }),
  );
  return provide;
};

it("a code block asks the code sources, with its language, and no others", async () => {
  const code = source("code");
  const any = source("any");
  const t = await openView("```python\n\n```\n\nafter", {
    enableCompletion: true,
  });
  t.select(1);
  t.type("pri");
  expect(code).toHaveBeenCalled();
  expect(code.mock.lastCall![0]).toMatchObject({
    language: "python",
    match: "pri",
  });
  expect(any).not.toHaveBeenCalled();
});

it("the text never asks the code sources", async () => {
  const code = source("code");
  const any = source("any");
  const t = await openView("", { enableCompletion: true });
  t.type("pri");
  expect(any).toHaveBeenCalled();
  expect(code).not.toHaveBeenCalled();
});
