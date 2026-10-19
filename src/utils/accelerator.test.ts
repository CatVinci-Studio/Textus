import { describe, expect, it } from "vitest";
import {
  acceleratorFromEvent,
  acceleratorProblem,
  comboFromAccelerator,
  defaultQuickNoteAccelerator,
  formatAccelerator,
} from "./accelerator";

const press = (
  code: string,
  mods: Partial<
    Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>
  > = {},
) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("acceleratorFromEvent", () => {
  it("names the physical key, whatever character it typed", () => {
    // ⌃⌥N on a Mac: Option made the key "˜", the code is still KeyN.
    expect(
      acceleratorFromEvent(press("KeyN", { ctrlKey: true, altKey: true })),
    ).toBe("Control+Alt+N");
    expect(
      acceleratorFromEvent(press("Digit3", { metaKey: true, shiftKey: true })),
    ).toBe("Shift+Super+3");
    expect(acceleratorFromEvent(press("F5", { ctrlKey: true }))).toBe(
      "Control+F5",
    );
    expect(
      acceleratorFromEvent(press("Space", { ctrlKey: true, shiftKey: true })),
    ).toBe("Control+Shift+Space");
  });

  it("waits while only modifiers are held", () => {
    expect(acceleratorFromEvent(press("ControlLeft", { ctrlKey: true }))).toBe(
      null,
    );
    expect(acceleratorFromEvent(press("MetaRight", { metaKey: true }))).toBe(
      null,
    );
    expect(acceleratorFromEvent(press(""))).toBe(null);
    expect(acceleratorFromEvent(press("IntlBackslash"))).toBe(null);
  });
});

describe("the default shortcut", () => {
  it("is ⌃⌥N on a Mac, Ctrl+Alt+N on Linux and Win+Alt+N on Windows", () => {
    expect(formatAccelerator(defaultQuickNoteAccelerator("mac"), "mac")).toBe(
      "⌃⌥N",
    );
    expect(
      formatAccelerator(defaultQuickNoteAccelerator("linux"), "linux"),
    ).toBe("Ctrl+Alt+N");
    expect(
      formatAccelerator(defaultQuickNoteAccelerator("windows"), "windows"),
    ).toBe("Win+Alt+N");
  });
});

describe("formatAccelerator", () => {
  it("writes the modifiers the way each platform does", () => {
    const accel = "Control+Alt+Shift+Super+ArrowUp";
    expect(formatAccelerator(accel, "mac")).toBe("⌃⌥⇧⌘↑");
    expect(formatAccelerator(accel, "windows")).toBe("Win+Ctrl+Alt+Shift+↑");
    expect(formatAccelerator(accel, "linux")).toBe("Ctrl+Alt+Shift+Super+↑");
  });
});

describe("comboFromAccelerator", () => {
  it("speaks the in-app combo strings, where mod is ⌘ on a Mac and Ctrl elsewhere", () => {
    expect(comboFromAccelerator("Super+Shift+S", "mac")).toBe("mod+shift+s");
    expect(comboFromAccelerator("Control+Shift+S", "linux")).toBe(
      "mod+shift+s",
    );
    expect(comboFromAccelerator("Control+Alt+N", "mac")).toBe("ctrl+alt+n");
    expect(comboFromAccelerator("Super+Alt+N", "windows")).toBe("meta+alt+n");
    expect(comboFromAccelerator("Control+Shift+Space", "linux")).toBe(
      "mod+shift+space",
    );
    expect(comboFromAccelerator("Control+Super+ArrowLeft", "mac")).toBe(
      "mod+ctrl+arrowleft",
    );
    expect(comboFromAccelerator("Control+Backslash", "windows")).toBe("mod+\\");
  });

  it("round-trips a recorded key press", () => {
    for (const os of ["mac", "windows", "linux"] as const) {
      const accel = acceleratorFromEvent(
        press("KeyK", { ctrlKey: true, shiftKey: true }),
      )!;
      expect(comboFromAccelerator(accel, os)).toBe(
        os === "mac" ? "ctrl+shift+k" : "mod+shift+k",
      );
    }
  });
});

describe("acceleratorProblem", () => {
  it("wants two modifiers, or one with a function key", () => {
    expect(acceleratorProblem("Control+N", [], "linux")).toBe(
      "tooFewModifiers",
    );
    expect(acceleratorProblem("F8", [], "linux")).toBe("tooFewModifiers");
    expect(acceleratorProblem("Control+F8", [], "linux")).toBe(null);
    expect(acceleratorProblem("Control+Alt+N", [], "linux")).toBe(null);
  });

  it("refuses what Textus uses itself", () => {
    // Completion's Ctrl+Shift+Space, as Settings › Shortcuts has it.
    expect(
      acceleratorProblem("Control+Shift+Space", ["mod+shift+space"], "linux"),
    ).toBe("inApp");
    expect(
      acceleratorProblem("Super+Shift+Space", ["mod+shift+space"], "mac"),
    ).toBe("inApp");
    expect(
      acceleratorProblem("Control+Shift+Space", ["mod+shift+space"], "mac"),
    ).toBe(null);
  });
});
