// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// An iPhone at phone width: the surfaces below take their phone form.
vi.mock("../platform/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isIOSApp: true,
}));
vi.mock("../settings/SettingsContext", () => ({
  useSettings: () => ({ t: { cancel: "Cancel" } }),
}));
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width"),
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const { ContextMenu } = await import("../ui/ContextMenu");
const { Select } = await import("../ui/Select");

describe("on a phone", () => {
  it("a menu is an action sheet with Cancel set apart", () => {
    const share = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        title="notes.md"
        items={[
          { label: "Share", onSelect: share },
          "separator",
          { label: "Delete", onSelect: () => {}, danger: true },
        ]}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("menu", { name: "notes.md" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));
    expect(share).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("a select is the system's own picker", () => {
    const onChange = vi.fn();
    render(
      <Select value="b" onChange={onChange} aria-label="Mode">
        <option value="a">Ask</option>
        <option value="b">
          <span>Edit</span>
        </option>
      </Select>,
    );
    const native = screen.getByRole("combobox", { name: "Mode" });
    expect(native.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "Edit" })).toBeInTheDocument();
    fireEvent.change(native, { target: { value: "a" } });
    expect(onChange).toHaveBeenCalledWith({ target: { value: "a" } });
  });
});
