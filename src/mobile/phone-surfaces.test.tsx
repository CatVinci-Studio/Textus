// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// An iPhone at phone width: the surfaces below take their phone form.
vi.mock("../platform/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isIOSApp: true,
  isMobileApp: true,
}));
vi.mock("../prefs/SettingsContext", () => ({
  useSettings: () => ({ t: { cancel: "Cancel", dialogOk: "OK" } }),
}));
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width"),
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const { ContextMenu } = await import("../engine/controls/ContextMenu");
const { Select } = await import("../engine/controls/Select");
const { ColorField } = await import("../engine/controls/ColorField");

describe("on a phone", () => {
  it("a menu is the desktop's, and takes the focus from a field", () => {
    const share = vi.fn();
    const onClose = vi.fn();
    // Typing in a document: the menu takes the focus from it.
    const doc = document.createElement("textarea");
    document.body.append(doc);
    doc.focus();
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
    expect(screen.getByRole("menu", { name: "notes.md" })).toHaveClass(
      "context-menu",
    );
    expect(document.querySelector(".sheet-scrim")).toBeNull();
    expect(doc).not.toHaveFocus();
    doc.remove();
    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));
    expect(share).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("a menu keeps its check and its rows not offered now", () => {
    const copy = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        items={[
          { label: "notes.md", onSelect: () => {}, checked: true },
          { label: "todo.md", onSelect: () => {}, checked: false },
          { label: "Copy", onSelect: copy, disabled: true },
        ]}
        onClose={() => {}}
      />,
    );
    expect(
      screen.getByRole("menuitemradio", { name: "notes.md" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemradio", { name: "todo.md" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeDisabled();
  });

  it("a menu brings the checked row into view", () => {
    const seen = vi.fn();
    Element.prototype.scrollIntoView = function (this: Element) {
      seen(this.textContent);
    };
    render(
      <ContextMenu
        x={0}
        y={0}
        items={[
          { label: "a.md", onSelect: () => {}, checked: false },
          { label: "z.md", onSelect: () => {}, checked: true },
        ]}
        onClose={() => {}}
      />,
    );
    expect(seen).toHaveBeenCalledWith("z.md");
  });

  it("a select opens the app's own menu, not the system's picker", () => {
    const onChange = vi.fn();
    render(
      <Select value="b" onChange={onChange} aria-label="Mode">
        <option value="a">Ask</option>
        <option value="b">
          <span>Edit</span>
        </option>
      </Select>,
    );
    const button = screen.getByRole("button", { name: "Mode" });
    expect(document.querySelector("select")).toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole("menu", { name: "Mode" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Edit" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Ask" }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: "a" } });
  });
});

describe("a colour on a phone", () => {
  it("opens the app's own card of tones and a hex field, not the system's picker", () => {
    document.documentElement.style.setProperty("--tone-blue", "#007aff");
    const onChange = vi.fn();
    render(<ColorField value="#000000" onChange={onChange} label="Accent" />);
    expect(document.querySelector('input[type="color"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Accent" }));
    fireEvent.click(screen.getByRole("radio", { name: "#007aff" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onChange).toHaveBeenCalledWith("#007aff");
  });
});

describe("any menu", () => {
  it("draws no rule at its ends or twice in a row", async () => {
    const { tidy } = await import("../engine/controls/ContextMenu");
    const a = { label: "A", onSelect: () => {} };
    const b = { label: "B", onSelect: () => {} };
    expect(
      tidy([
        "separator",
        "separator",
        a,
        "separator",
        "separator",
        b,
        "separator",
      ]),
    ).toEqual([a, "separator", b]);
  });
});
