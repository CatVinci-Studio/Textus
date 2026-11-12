import { afterEach, expect, it } from "vitest";
import { settingsInUse } from "./settings-nav";
import {
  activateTab,
  resetWindowModelForTests,
  startWindowTabs,
} from "../engine/layout/store";

afterEach(() => resetWindowModelForTests());

it("gives Ctrl/Cmd+F to Settings' search only while its tab is in use", () => {
  const settings = { id: "s", view: { kind: "page", view: "settings" } };
  startWindowTabs([{ id: "a" }, settings], () => ({ id: "blank" }));
  expect(settingsInUse()).toBe(false);
  activateTab("s");
  expect(settingsInUse()).toBe(true);
});
