// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../prefs/SettingsContext", () => ({
  useSettings: () => ({
    t: {
      cancel: "Cancel",
      docMore: "More",
      outlineTab: "Outline",
      outlineEmpty: "No headings yet",
      menuFindReplace: "Find & Replace…",
      menuToggleSourceMode: "Source Mode",
      menuShare: "Share…",
    },
  }),
}));
vi.mock("../platform/menu-events", () => ({ emitMenuEvent: vi.fn() }));
vi.mock("../utils/events", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendAppEvent: vi.fn(),
}));
vi.mock("../editor/tab-jump", () => ({ setTabJump: vi.fn() }));
vi.mock("../editor/nav-history", () => ({ noteJump: vi.fn() }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width"),
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const { DocumentMenu } = await import("./DocumentMenu");
const { emitMenuEvent } = await import("../platform/menu-events");
const { sendAppEvent, TOGGLE_FIND_REPLACE_EVENT } =
  await import("../utils/events");
const { setTabJump } = await import("../editor/tab-jump");

function open() {
  render(
    <DocumentMenu
      title="notes.md"
      content={"# One\n\n## Two\n"}
      tabId="tab-1"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "More" }));
}

describe("a document's menu on a phone", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens its actions under the document's name", () => {
    open();
    expect(screen.getByRole("menu", { name: "notes.md" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Outline" })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Find & Replace…" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Source Mode" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Share…" })).toBeTruthy();
  });

  it("opens the outline, and a row goes to its heading", () => {
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Outline" }));
    expect(screen.getByRole("menu", { name: "Outline" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "One" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Two" }));
    expect(setTabJump).toHaveBeenCalledWith(
      "tab-1",
      { kind: "outline", index: 1 },
      true,
    );
  });

  it("runs the same commands the menus do", () => {
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Find & Replace…" }));
    expect(sendAppEvent).toHaveBeenCalledWith(TOGGLE_FIND_REPLACE_EVENT);
    cleanup();

    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Source Mode" }));
    expect(emitMenuEvent).toHaveBeenCalledWith("toggle-source-mode");
    cleanup();

    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Share…" }));
    expect(emitMenuEvent).toHaveBeenCalledWith("share");
  });

  it("is the desktop's menu, and Android's Back closes it", async () => {
    const { back } = await import("./back");
    open();
    const menu = screen.getByRole("menu", { name: "notes.md" });
    expect(menu).toHaveClass("context-menu");
    expect(document.querySelector(".sheet-scrim")).toBeNull();
    menu.getClientRects = () => [{}] as unknown as DOMRectList;
    act(() => {
      expect(back()).toBe(true);
    });
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
