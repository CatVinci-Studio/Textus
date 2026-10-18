// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The strip's own controls. The sidebar toggle is the sidebar's third way in
 * (after mod+\ and the View menu) and the only one that is always on screen,
 * so its label, pressed state and wiring are worth pinning - as is the AI
 * toggle keeping a class of its own: several e2e flows click
 * `.window-bar-toggle` in strict mode and mean that one exactly.
 */

// jsdom has no ResizeObserver, and the menu is kept inside the window by
// useViewportClamp, which observes itself.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock("../platform/ipc", () => ({
  menuIpc: {
    triggerMenuItem: (id: string) => Promise.resolve(id),
    listRecentFiles: () => Promise.resolve([]),
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
  }),
}));

vi.mock("../settings/SettingsContext", async () => {
  const { resolveStrings } = await import("../i18n/strings");
  return {
    useSettings: () => ({
      t: resolveStrings("en"),
      settings: {
        shortcuts: {
          toggleSidebar: "mod+\\",
          toggleAgentPanel: "mod+shift+l",
        },
      },
    }),
  };
});

// The button is drawn whichever frame the platform supplies - the point of
// the immersive strip - so the gate stays open for every case here.
vi.mock("../platform/window-chrome", () => ({
  appDrawsWindowFrame: true,
}));

const { WindowBar } = await import("./WindowBar");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// JSX attribute strings don't process escapes, so the shortcut is passed as
// an expression - it must come out the other side byte for byte.
const shortcut = "Ctrl+\\";

function renderBar(
  props: Partial<React.ComponentProps<typeof WindowBar>> = {},
) {
  return render(
    <WindowBar
      menuChecks={{}}
      title="draft.md"
      dirty={false}
      largeDoc={false}
      words={0}
      sidebarOpen={false}
      sidebarShortcut={shortcut}
      onToggleSidebar={vi.fn()}
      showAgentToggle={false}
      agentOpen={false}
      agentShortcut="Ctrl+Shift+L"
      onToggleAgent={vi.fn()}
      {...props}
    />,
  );
}

describe("the sidebar's toggle in the strip", () => {
  it("names the sidebar, carries its shortcut, and toggles on click", () => {
    const onToggleSidebar = vi.fn();
    renderBar({ onToggleSidebar });

    const button = screen.getByRole("button", { name: "Sidebar" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("title", `Sidebar (${shortcut})`);

    fireEvent.click(button);
    expect(onToggleSidebar).toHaveBeenCalledOnce();
  });

  it("reads as pressed while the sidebar is open", () => {
    renderBar({ sidebarOpen: true });
    expect(screen.getByRole("button", { name: "Sidebar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("lives beside the app menu, in the pinned corner cluster", () => {
    renderBar();
    const cluster = document.querySelector(".window-bar-left")!;
    expect(cluster).toHaveAttribute("data-tauri-drag-region");
    expect(cluster.contains(screen.getByRole("button", { name: "Menu" }))).toBe(
      true,
    );
  });
});

describe("the AI panel's toggle", () => {
  it("keeps a class of its own, so the e2e flows' exact selector stays exact", () => {
    renderBar({ showAgentToggle: true });
    expect(document.querySelector(".window-bar-toggle")).not.toBeNull();
    const sidebarToggle = document.querySelector(".window-bar-sidebar-toggle")!;
    expect(sidebarToggle).not.toHaveClass("window-bar-toggle");
  });
});
