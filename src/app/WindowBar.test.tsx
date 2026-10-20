// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The bar's own controls. The sidebar's toggle is its third way in (after
 * mod+\ and the View menu) and the only one always on screen, so its
 * label, pressed state and wiring are pinned here - as is the AI toggle
 * keeping a class of its own: several e2e flows click `.window-bar-toggle`
 * in strict mode and mean that one exactly.
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
      settings: { shortcuts: {} },
    }),
  };
});

// The app draws the frame here, so the menu button is in the bar too.
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

describe("the sidebar's toggle in the window bar", () => {
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
    expect(document.querySelector(".window-bar")).toHaveClass(
      "window-bar-sidebar-open",
    );
  });

  it("leads the app menu in the bar's own drag-region cluster", () => {
    renderBar();
    const cluster = document.querySelector(".window-bar-left")!;
    expect(cluster).toHaveAttribute("data-tauri-drag-region");
    expect(cluster.firstElementChild).toHaveClass("window-bar-sidebar-toggle");
    expect(cluster.contains(screen.getByRole("button", { name: "Menu" }))).toBe(
      true,
    );
  });
});

describe("the AI panel's toggle", () => {
  it("keeps a class of its own, so the e2e flows' exact selector stays exact", () => {
    renderBar({ showAgentToggle: true });
    expect(document.querySelectorAll(".window-bar-toggle")).toHaveLength(1);
    expect(
      document.querySelector(".window-bar-sidebar-toggle"),
    ).not.toHaveClass("window-bar-toggle");
  });
});
