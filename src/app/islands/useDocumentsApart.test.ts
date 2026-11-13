// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useDocumentsApart } from "./useDocumentsApart";
import { isPanelPane } from "./panel-pane";
import {
  resetWindowModelForTests,
  setWindowTabs,
  startWindowTabs,
  windowLayout,
  windowTabs,
} from "../../engine/layout/store";
import { panesOf, type Pane } from "../../engine/layout/tree";
import type { DocTab } from "../../document/doc-tabs";

afterEach(() => {
  cleanup();
  resetWindowModelForTests();
});

const ai = {
  id: "ai",
  view: { kind: "page", view: "ai" },
} as unknown as DocTab;
const doc = { id: "doc" } as DocTab;

it("puts a document opened in the AI's island (Ctrl/⌘ N, the sidebar) beside it", () => {
  startWindowTabs([ai], () => ({ id: "blank" }) as DocTab);
  const isPanel = (p: Pane) =>
    isPanelPane(p, (id) => windowTabs<DocTab>().find((t) => t.id === id)?.view);
  const { rerender } = renderHook(
    ({ tabs }) => useDocumentsApart(tabs, isPanel),
    { initialProps: { tabs: [ai] } },
  );
  act(() => setWindowTabs<DocTab>((prev) => [...prev, doc]));
  rerender({ tabs: [ai, doc] });
  expect(panesOf(windowLayout().root).map((p) => p.tabs)).toEqual([
    ["doc"],
    ["ai"],
  ]);
});
