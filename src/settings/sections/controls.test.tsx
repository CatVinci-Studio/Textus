// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutRow } from "./shortcut-rows";
import { resolveStrings } from "../../i18n/strings";
import { defaultShortcuts, type Shortcuts } from "../../prefs/SettingsContext";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const shortcuts: Shortcuts = {
  ...defaultShortcuts(true),
  triggerCompletion: "mod+shift+space",
  triggerGrammarCheck: "mod+shift+g",
  toggleFloatingChat: "mod+shift+k",
  findReplace: "mod+f",
  toggleSidebar: "mod+\\",
  toggleAgentPanel: "mod+shift+l",
  toggleSplitView: "mod+shift+e",
  toggleZenMode: "mod+shift+j",
  toggleSourceMode: "mod+/",
  toggleTypewriterMode: "",
  searchFiles: "mod+shift+o",
};
function setup() {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const save = vi.fn();
  render(
    <ShortcutRow
      label="Find"
      action="findReplace"
      shortcuts={shortcuts}
      setSettings={save}
      t={resolveStrings("en")}
    />,
  );
  const button = screen.getByRole("button", { name: "Find: ⌘F" });
  fireEvent.click(button);
  return { save, button };
}
describe("shortcut recording", () => {
  it("reports a duplicate without changing either shortcut", () => {
    const { save, button } = setup();
    fireEvent.keyDown(button, { key: "g", metaKey: true, shiftKey: true });
    expect(screen.getByRole("alert")).toHaveTextContent(
      resolveStrings("en").shortcutTriggerGrammarCheck,
    );
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects a fixed app shortcut, then accepts a valid replacement", () => {
    const { save, button } = setup();
    fireEvent.keyDown(button, { key: "s", metaKey: true });
    expect(screen.getByRole("alert")).toHaveTextContent(
      resolveStrings("en").shortcutReserved,
    );
    fireEvent.keyDown(button, { key: "u", metaKey: true, shiftKey: true });
    expect(save).toHaveBeenCalledWith({
      shortcuts: { ...shortcuts, findReplace: "mod+shift+u" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("stops recording on Escape or blur without changing settings", () => {
    const { save, button } = setup();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    fireEvent.blur(button);
    fireEvent.keyDown(window, { key: "j", metaKey: true });
    expect(save).not.toHaveBeenCalled();
  });
});
describe("resetting a shortcut", () => {
  function heading(current: Shortcuts) {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const save = vi.fn();
    render(
      <ShortcutRow
        label="Heading 2"
        action="setHeading2"
        shortcuts={current}
        setSettings={save}
        t={resolveStrings("en")}
      />,
    );
    return save;
  }
  it("is offered only away from the default, and puts it back", () => {
    const save = heading({ ...shortcuts, setHeading2: "" });
    expect(
      screen.getByRole("button", { name: "Heading 2: Not set" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Reset: Heading 2" }));
    expect(save).toHaveBeenCalledWith({
      shortcuts: { ...shortcuts, setHeading2: "mod+2" },
    });
    cleanup();
    heading(shortcuts);
    expect(screen.getByRole("button", { name: "Heading 2: ⌘2" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Reset: Heading 2" }),
    ).toBeNull();
  });
  it("reports the action that has the default now instead of taking it", () => {
    const save = heading({
      ...shortcuts,
      setHeading2: "",
      toggleZenMode: "mod+2",
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset: Heading 2" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      resolveStrings("en").menuToggleZenMode,
    );
    expect(save).not.toHaveBeenCalled();
  });
});

describe("a key a fixed shortcut owns", () => {
  const fixed = [
    { title: "View", items: [{ label: "Actual Size", combos: ["mod+0"] }] },
  ];

  it("is refused with the fixed shortcut's name", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const save = vi.fn();
    render(
      <ShortcutRow
        label="Paragraph"
        action="setParagraph"
        shortcuts={shortcuts}
        setSettings={save}
        t={resolveStrings("en")}
        fixed={fixed}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Paragraph: Not set" }));
    fireEvent.keyDown(window, { key: "0", metaKey: true });
    expect(screen.getByRole("alert")).toHaveTextContent("Actual Size");
    expect(save).not.toHaveBeenCalled();
  });

  it("bound already, is shown as taken", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    render(
      <ShortcutRow
        label="Paragraph"
        action="setParagraph"
        shortcuts={{ ...shortcuts, setParagraph: "mod+0" }}
        setSettings={vi.fn()}
        t={resolveStrings("en")}
        fixed={fixed}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Actual Size");
  });
});
