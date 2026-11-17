import { afterEach, expect, it, vi } from "vitest";
import { setWindowTabs } from "../engine/layout/store";
import { leaveTab, leftBy } from "../editor/tab-left";
import { fileTextFor, leaveTracked, leftTracked } from "./tracked-file";

vi.mock("../platform/ipc", () => ({ ownNotes: {} }));

afterEach(() => setWindowTabs(() => []));

it("an editor going because its tab closed leaves no original and no state behind", () => {
  setWindowTabs(() => [{ id: "a", path: "/w/a.md" }]);
  // Out of sight, still open: kept for its next editor.
  leaveTracked("/w/a.md", "original");
  leaveTab("a", { markdown: "text" } as never);
  expect(leftTracked("/w/a.md")).toBe("original");
  expect(leftBy("a", "text")).not.toBeNull();
  // Closed: the model drops the tab before its editor unmounts.
  setWindowTabs(() => []);
  leaveTracked("/w/a.md", "original");
  leaveTab("b", { markdown: "text" } as never);
  expect(leftTracked("/w/a.md")).toBeNull();
  expect(fileTextFor("/w/a.md", "edited elsewhere")).toBe("edited elsewhere");
  expect(leftBy("b", "text")).toBeNull();
});
