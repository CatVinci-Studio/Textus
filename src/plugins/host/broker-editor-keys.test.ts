// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en";
import type { Strings } from "../../i18n/strings";

const notices = vi.hoisted(() => ({ showNotice: vi.fn() }));
vi.mock("../../ui/notices", () => notices);

import { editorHandlers, stopPluginEditor } from "./broker-editor";
import type { PluginScope } from "./broker-scope";

const scope = (id: string, name: string) =>
  ({
    id,
    name: () => name,
    t: () => en as Strings,
    event: vi.fn(),
  }) as unknown as PluginScope;

afterEach(() => {
  stopPluginEditor("a.vim");
  stopPluginEditor("a.emacs");
});

it("refuses a second plugin the keyboard and tells the user once", () => {
  const vim = editorHandlers(scope("a.vim", "Vim"));
  const emacs = editorHandlers(scope("a.emacs", "Emacs"));
  const all = { mode: "all", keys: [] };
  expect(vim["editor.captureKeys"](all)).toBe(true);
  expect(emacs["editor.captureKeys"](all)).toBe(false);
  expect(emacs["editor.captureKeys"](all)).toBe(false);
  expect(notices.showNotice).toHaveBeenCalledTimes(1);
  expect(notices.showNotice.mock.calls[0][0]).toContain("Emacs");
  expect(notices.showNotice.mock.calls[0][0]).toContain("Vim");
  expect(emacs["editor.captureKeys"](null)).toBe(false);
  expect(vim["editor.captureKeys"](null)).toBe(true);
  expect(emacs["editor.captureKeys"](all)).toBe(true);
});
