// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../prefs/SettingsContext", () => ({
  useSettings: () => ({
    t: {
      cancel: "Cancel",
      outlineTab: "Outline",
      outlineEmpty: "No headings yet",
    },
  }),
}));
vi.mock("../files/outline-current", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../files/outline-current")>()),
  currentHeading: () => 1,
}));
vi.mock("../editor/tab-jump", () => ({ setTabJump: vi.fn() }));
vi.mock("../editor/nav-history", () => ({ noteJump: vi.fn() }));

beforeAll(() => {
  window.matchMedia = (() => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const { OutlineMenu } = await import("./OutlineMenu");
const { setTabJump } = await import("../editor/tab-jump");

function renderSheet(content: string) {
  render(
    <OutlineMenu
      content={content}
      tabId="tab-1"
      at={{ x: 300, y: 40, anchor: null }}
      onClose={() => {}}
    />,
  );
}

describe("a document's outline on a phone", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("indents its headings and ticks the section being read", () => {
    renderSheet("# One\n\n## Two\n\n### Three\n");
    expect(screen.getByRole("menu", { name: "Outline" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "One" })).toHaveAttribute(
      "data-depth",
      "1",
    );
    expect(screen.getByRole("menuitem", { name: "Two" })).toHaveAttribute(
      "data-depth",
      "2",
    );
    expect(screen.getByRole("menuitem", { name: "Three" })).toHaveAttribute(
      "data-depth",
      "3",
    );
    // currentHeading says the second section is being read.
    expect(screen.getByRole("menuitem", { name: "Two" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(screen.getByRole("menuitem", { name: "One" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("goes to a heading's row", () => {
    renderSheet("# One\n\n## Two\n\n### Three\n");
    fireEvent.click(screen.getByRole("menuitem", { name: "Three" }));
    expect(setTabJump).toHaveBeenCalledWith(
      "tab-1",
      { kind: "outline", index: 2 },
      true,
    );
  });

  it("says so when there are no headings", () => {
    renderSheet("Only body text.\n");
    expect(
      screen.getByRole("menuitem", { name: "No headings yet" }),
    ).toBeDisabled();
  });
});
