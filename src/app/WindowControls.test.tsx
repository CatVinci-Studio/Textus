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
 * The caption is the only way to close a frameless window, and must be absent
 * where the OS frame remains, so both halves of the gate are pinned.
 */

// jsdom has no ResizeObserver; nothing here resizes, so a silent stub will do.
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
    listRecentFolders: () => Promise.resolve([]),
  },
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

// The real string table, in Chinese: a hand-written stub would pass whether
// or not the menu follows the chosen language.
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
          searchFiles: "mod+shift+o",
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
    expect(screen.getByRole("menuitem", { name: /文件/ })).toBeInTheDocument();

    const menu = document.querySelector(".app-menu") as HTMLElement;
    expect(menu.style.left).toBe("12px");
    expect(menu.style.top).toBe("30px");
  });

  it("sends a chosen item back to the native menu's own dispatch", () => {
    appDrawsWindowFrame.value = true;
    render(<AppMenuButton />);
    fireEvent.click(screen.getByLabelText("菜单"));
    fireEvent.click(screen.getByRole("menuitem", { name: /设置/ }));

    // By id, so the item can't drift from its native twin.
    expect(triggerMenuItem).toHaveBeenCalledWith("settings");
  });

  it("closes again when the button is clicked a second time", async () => {
    appDrawsWindowFrame.value = true;
    render(<AppMenuButton />);
    const button = screen.getByLabelText("菜单");

    fireEvent.click(button);
    expect(screen.getByRole("menuitem", { name: /文件/ })).toBeInTheDocument();

    // Mousedown then click, after the dismiss listener attaches: a button
    // outside the dismiss boundary would close and then reopen the menu.
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
      screen.getByRole("menuitem", { name: /新建标签页/ }),
    ).toBeInTheDocument();
  });
});
