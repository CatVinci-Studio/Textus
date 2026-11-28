// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { installTestLocalStorage } from "../dev/test-local-storage";
import { resetUiStateForTests } from "../storage/ui-state";
import { loadSettings } from "./settings-store";
import { migrateTreeHidden } from "./tree-hidden-migration";

const OLD = "textus-file-tree-hidden";

beforeEach(() => {
  installTestLocalStorage();
  localStorage.clear();
  resetUiStateForTests();
});

it("keeps the tree's old Show Hidden Files on, once, as the new setting", async () => {
  localStorage.setItem(OLD, "1");
  expect(loadSettings().showHiddenFiles).toBe(false);
  await migrateTreeHidden();
  expect(loadSettings().showHiddenFiles).toBe(true);
  expect(localStorage.getItem(OLD)).toBe("0");
});

it("leaves the setting off where the old one was off or never set", async () => {
  await migrateTreeHidden();
  expect(loadSettings().showHiddenFiles).toBe(false);
  localStorage.setItem(OLD, "0");
  await migrateTreeHidden();
  expect(loadSettings().showHiddenFiles).toBe(false);
});
