// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import { defaultEditor } from "../../platform/ipc";
import { DefaultEditorSection } from "./general";

vi.mock("../../platform/ipc", () => ({
  cli: {},
  updater: {},
  defaultEditor: { status: vi.fn(), set: vi.fn() },
}));

const t = resolveStrings("en");
const status = vi.mocked(defaultEditor.status);
const set = vi.mocked(defaultEditor.set);
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  set.mockResolvedValue(undefined);
});

describe("the default editor row", () => {
  it("makes Textus the default where the system allows it", async () => {
    status.mockResolvedValueOnce({
      supported: true,
      isDefault: false,
      chooseInSettings: false,
    });
    status.mockResolvedValue({
      supported: true,
      isDefault: true,
      chooseInSettings: false,
    });
    render(<DefaultEditorSection t={t} />);
    fireEvent.click(
      await screen.findByRole("button", { name: t.defaultEditorButton }),
    );
    expect(await screen.findByText(t.defaultEditorIsDefault)).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    expect(set).toHaveBeenCalledOnce();
  });

  it("on Windows opens Default apps and says what to choose there", async () => {
    status.mockResolvedValue({
      supported: true,
      isDefault: false,
      chooseInSettings: true,
    });
    render(<DefaultEditorSection t={t} />);
    const button = await screen.findByRole("button", {
      name: t.defaultEditorButton,
    });
    expect(screen.queryByText(t.defaultEditorChooseHint)).toBeNull();
    fireEvent.click(button);
    expect(await screen.findByText(t.defaultEditorChooseHint)).toBeVisible();
    expect(screen.getByText(t.defaultEditorNotDefault)).toBeVisible();
    expect(set).toHaveBeenCalledOnce();
  });

  it("explains instead of offering the button where it can't be set", async () => {
    status.mockResolvedValue({
      supported: false,
      isDefault: false,
      chooseInSettings: false,
    });
    render(<DefaultEditorSection t={t} />);
    expect(await screen.findByText(t.defaultEditorUnsupported)).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
