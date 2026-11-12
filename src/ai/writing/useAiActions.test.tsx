// @vitest-environment jsdom
import { act, render, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NoticeHost } from "../../engine/controls/notices";
import { useAiActions } from "./useAiActions";
import type { Settings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";

let finish: () => void = () => {};
vi.mock("./ghost-text-plugin", () => ({
  triggerGhostTextNow: () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
}));

it("clears the working note once the continuation is in", async () => {
  const { container } = render(<NoticeHost />);
  const settings = {
    completionTone: "",
    writingModels: {},
    language: "en",
  } as unknown as Settings;
  const t = { aiWorkingCompletion: "Writing a continuation…" } as Strings;
  const { result } = renderHook(() =>
    useAiActions(
      (fn) => fn({ get: () => ({}) } as never),
      () => settings,
      () => t,
      () => {},
    ),
  );
  act(() => result.current.triggerCompletion());
  expect(container.textContent).toContain("Writing a continuation…");
  await act(async () => finish());
  expect(container.textContent).not.toContain("Writing a continuation…");
});
