// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The caption is the only way to close a window that has no OS frame, and it
 * must be absent on the platform that still has one - so both halves of the
 * gate are worth pinning down. A regression either way is invisible in
 * review and total in use: a stranded window on Windows, or a second set of
 * buttons next to the traffic lights on macOS.
 */

// jsdom has no ResizeObserver, and the menu is kept inside the window by
// useViewportClamp, which observes itself. Nothing here resizes, so a stub
// that never fires is enough.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const triggerMenuItem = vi.fn((id: string) => Promise.resolve(id));
const minimize = vi.fn();
const toggleMaximize = vi.fn();
const close = vi.fn();

vi.mock("../platform/ipc", () => ({
  menuIpc: {
    triggerMenuItem: (id: string) => triggerMenuItem(id),
    listRecentFiles: () => Promise.resolve([]),
  },
}));

// No Quick Note shortcut registered: New Quick Note shows none.
vi.mock("../platform/useQuickNoteShortcut", () => ({
  useQuickNoteShortcut: () => null,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize,
    toggleMaximize,
    close,
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
  }),
}));

// The real string table, in Chinese: the menu is drawn in HTML precisely so
// that it follows the language picked in Settings, and a hand-written stub
// would pass whether or not it does.
vi.mock("../settings/SettingsContext", async () => {
  const { resolveStrings } = await import("../i18n/strings");
  return {
    useSettings: () => ({
      t: resolveStrings("zh"),
      settings: {
        shortcuts: {
          triggerCompletion: "mod+shift+space",
          triggerGrammarCheck: "mod+shift+g",
          toggleFloatingChat: "mod+shift+k",
          toggleSidebar: "mod+\\",
          toggleAgentPanel: "mod+shift+l",
          toggleSplitView: "mod+shift+e",
          toggleZenMode: "mod+shift+j",
          toggleSourceMode: "mod+/",
          toggleTypewriterMode: "",
          findReplace: "mod+f",
        },
      },
    }),
  };
});

const appDrawsWindowFrame = vi.hoisted(() => ({ value: false }));
vi.mock("../platform/window-chrome", () => ({
  get appDrawsWindowFrame() {
    return appDrawsWindowFrame.value;
  },
}));

const { AppMenuButton } = await import("./WindowControls");
const { WindowCaptionButtons } = await import("../ui/WindowCaptionButtons");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("where the platform still draws the frame", () => {
  it("renders no caption and no menu button", () => {
    appDrawsWindowFrame.value = false;
    const { container } = render(
      <>
        <AppMenuButton />
        <WindowCaptionButtons />
      </>,
    );
    // macOS has its own traffic lights and its own menu bar; drawing ours
    // next to them would be two of everything.
    expect(container).toBeEmptyDOMElement();
  });
});

describe("where the app owns the frame", () => {
  it("draws minimize, maximize and close", () => {
    appDrawsWindowFrame.value = true;
    render(<WindowCaptionButtons />);

    fireEvent.click(screen.getByLabelText("最小化"));
    expect(minimize).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText("最大化"));
    expect(toggleMaximize).toHaveBeenCalledOnce();

    // close(), never destroy(): the editor's unsaved-document prompt and the
    // chat window's hand-the-conversation-back both hang off close-requested.
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(close).toHaveBeenCalledOnce();
  });

  it("opens the app menu in the app's own language", () => {
    appDrawsWindowFrame.value = true;
    render(<AppMenuButton />);
    const button = screen.getByLabelText("菜单");
    button.getBoundingClientRect = () => ({ left: 12, bottom: 28 }) as DOMRect;

    fireEvent.click(button);
    // The whole point of drawing it here: the native popup this replaced was
    // labelled from Rust string literals and stayed English in every locale.
    expect(screen.getByRole("menuitem", { name: /文件/ })).toBeInTheDocument();

    // Anchored just under the button it was opened from - a menu that lands
    // anywhere else reads as a stray context menu.
    const menu = document.querySelector(".app-menu") as HTMLElement;
    expect(menu.style.left).toBe("12px");
    expect(menu.style.top).toBe("30px");
  });

  it("sends a chosen item back to the native menu's own dispatch", () => {
    appDrawsWindowFrame.value = true;
    render(<AppMenuButton />);
    fireEvent.click(screen.getByLabelText("菜单"));
    fireEvent.click(screen.getByRole("menuitem", { name: /设置/ }));

    // By id, so the item cannot drift into doing something other than what
    // its twin in src-tauri/src/menu.rs does.
    expect(triggerMenuItem).toHaveBeenCalledWith("settings");
  });

  it("closes again when the button is clicked a second time", async () => {
    appDrawsWindowFrame.value = true;
    render(<AppMenuButton />);
    const button = screen.getByLabelText("菜单");

    fireEvent.click(button);
    expect(screen.getByRole("menuitem", { name: /文件/ })).toBeInTheDocument();

    // Deliberately mousedown-then-click, and only once the dismiss listener
    // has actually attached (it does so a tick late, on document, in the
    // capture phase). A bare click() would not reproduce the sequence that
    // matters: if the button sits OUTSIDE the dismiss boundary, mousedown
    // closes the menu and the click that follows reopens it, and the button
    // appears not to close the menu at all.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.mouseDown(button);
    fireEvent.click(button);

    expect(screen.queryByRole("menuitem", { name: /文件/ })).toBeNull();
  });

  it("closes on Escape and gives focus back to where it was", async () => {
    appDrawsWindowFrame.value = true;
    const editor = document.createElement("input");
    document.body.append(editor);
    editor.focus();

    render(<AppMenuButton />);
    fireEvent.click(screen.getByLabelText("菜单"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menuitem", { name: /文件/ })).toBeNull();
    // Reaching for the menu and changing your mind must not cost the caret.
    expect(document.activeElement).toBe(editor);
    editor.remove();
  });

  it("opens a submenu on hover", () => {
    appDrawsWindowFrame.value = true;
    render(<AppMenuButton />);
    fireEvent.click(screen.getByLabelText("菜单"));
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /文件/ }));

    expect(
      screen.getByRole("menuitem", { name: /新建文件/ }),
    ).toBeInTheDocument();
  });
});
