// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";

const memoryUndo = vi.fn();
const memoryMove = vi.fn();

vi.mock("../../prefs/SettingsContext", () => ({
  useSettings: () => ({ settings: { agentWorkspaceRoot: "" } }),
}));
vi.mock("../../platform/ipc", async () => {
  const actual =
    await vi.importActual<typeof import("../../platform/ipc")>(
      "../../platform/ipc",
    );
  return {
    ...actual,
    ai: {
      memoryUndo: (...args: unknown[]) => memoryUndo(...args),
      memoryMove: (...args: unknown[]) => memoryMove(...args),
    },
  };
});

const { MemoryChip, parseRememberResult } = await import("./MemoryChip");
const { chatLabels } = await import("./chat-labels");
const { IpcError } = await import("../../platform/ipc");

const labels = chatLabels(resolveStrings("zh"), "zh");

const saved = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    remembered: "project/memory/Use-quotes",
    scope: "project",
    created: true,
    text: "引号用「」。",
    previous: null,
    ...over,
  });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("parseRememberResult", () => {
  it("reads what was remembered", () => {
    expect(parseRememberResult(saved())).toEqual({
      remembered: "project/memory/Use-quotes",
      scope: "project",
      created: true,
      text: "引号用「」。",
      previous: null,
      name: null,
      forgot: false,
    });
  });

  it("is null for what saved nothing - a duplicate, a refusal", () => {
    expect(
      parseRememberResult("Already remembered as `project/memory/x`."),
    ).toBeNull();
    expect(parseRememberResult(saved({ scope: "team" }))).toBeNull();
  });
});

describe("MemoryChip", () => {
  it("says what was remembered and where, as the owner wrote it", () => {
    render(
      <MemoryChip
        result={parseRememberResult(saved())!}
        docPath="/novel/one.md"
        labels={labels}
      />,
    );
    expect(screen.getByTitle("已记住：引号用「」。（项目）")).toBeVisible();
    expect(screen.getByRole("button", { name: "撤销" })).toBeVisible();
    expect(screen.getByRole("button", { name: "改为全局" })).toBeVisible();
  });

  it("undoes a new memory by deleting it", async () => {
    memoryUndo.mockResolvedValue(undefined);
    render(
      <MemoryChip
        result={parseRememberResult(saved())!}
        docPath="/novel/one.md"
        labels={labels}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() =>
      expect(screen.getByText("已撤销，不再记住。")).toBeVisible(),
    );
    expect(memoryUndo).toHaveBeenCalledWith(
      "/novel/one.md",
      null,
      "project/memory/Use-quotes",
      null,
    );
  });

  it("undoes an update by putting the previous file back", async () => {
    memoryUndo.mockResolvedValue(undefined);
    const previous = "---\nkind: style\n---\nOld.\n";
    render(
      <MemoryChip
        result={parseRememberResult(saved({ created: false, previous }))!}
        docPath="/novel/one.md"
        labels={labels}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(memoryUndo).toHaveBeenCalled());
    expect(memoryUndo.mock.calls[0][3]).toBe(previous);
  });

  it("says what was forgotten, and undo remembers it again", async () => {
    memoryUndo.mockResolvedValue(undefined);
    const previous = "---\nkind: style\n---\n引号用「」。\n";
    render(
      <MemoryChip
        result={parseRememberResult(
          saved({ created: false, previous, forgot: true }),
        )!}
        docPath="/novel/one.md"
        labels={labels}
      />,
    );
    expect(screen.getByTitle("已忘记：引号用「」。（项目）")).toBeVisible();
    // Nowhere to move what is no longer kept.
    expect(screen.queryByRole("button", { name: "改为全局" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(memoryUndo).toHaveBeenCalled());
    expect(memoryUndo.mock.calls[0][3]).toBe(previous);
    expect(await screen.findByText("已撤销，重新记住。")).toBeVisible();
  });

  it("moves a memory to the other scope, and undo follows it there", async () => {
    memoryMove.mockResolvedValue("personal/memory/Use-quotes");
    memoryUndo.mockResolvedValue(undefined);
    render(
      <MemoryChip
        result={parseRememberResult(saved())!}
        docPath="/novel/one.md"
        labels={labels}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "改为全局" }));
    await waitFor(() =>
      expect(screen.getByTitle("已记住：引号用「」。（全局）")).toBeVisible(),
    );
    expect(memoryMove).toHaveBeenCalledWith(
      "/novel/one.md",
      null,
      "project/memory/Use-quotes",
      "personal",
    );
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(memoryUndo).toHaveBeenCalled());
    expect(memoryUndo.mock.calls[0][2]).toBe("personal/memory/Use-quotes");
  });

  it("offers no move for a fact, which only a project's library holds", () => {
    render(
      <MemoryChip
        result={parseRememberResult(
          saved({ remembered: "project/library/Lin" }),
        )!}
        docPath="/novel/one.md"
        labels={labels}
      />,
    );
    expect(screen.queryByRole("button", { name: "改为全局" })).toBeNull();
  });

  it("treats a memory deleted meanwhile as undone", async () => {
    memoryUndo.mockRejectedValue(new IpcError("memory_undo", "GONE"));
    render(
      <MemoryChip
        result={parseRememberResult(saved())!}
        docPath="/novel/one.md"
        labels={labels}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() =>
      expect(screen.getByText("已撤销，不再记住。")).toBeVisible(),
    );
  });
});
