// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../prefs/SettingsContext", () => ({
  useSettings: () => ({
    t: {
      cancel: "Cancel",
      docMore: "More",
      outlineTab: "Outline",
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

function open() {
  render(<DocumentMenu title="notes.md" onOutline={onOutline} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
}

const onOutline = vi.fn();

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

  it("runs the same commands the menus do", () => {
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Outline" }));
    expect(onOutline).toHaveBeenCalledOnce();
    cleanup();

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
});
