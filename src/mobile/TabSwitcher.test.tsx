// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DocTab } from "../document/doc-tabs";

vi.mock("../prefs/SettingsContext", () => ({
  useSettings: () => ({
    t: {
      menuAllTabs: "All Tabs",
      menuCloseTab: "Close Tab",
      menuNewTab: "New Tab",
      cancel: "Cancel",
      unsavedIndicator: "Unsaved",
      untitledTab: "Untitled",
      startPageTab: "Start",
    },
  }),
}));

beforeAll(() => {
  window.matchMedia = (() => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const { TabSwitcher } = await import("./TabSwitcher");
const { makeBlankTab } = await import("../document/doc-tabs");

const tab = (id: string, path: string): DocTab => ({
  ...makeBlankTab(),
  id,
  path,
  content: "same",
  savedContent: "same",
});

describe("a phone's tabs behind the document's name", () => {
  it("shows the tab in front and how many are open", () => {
    render(
      <TabSwitcher
        tabs={[tab("a", "/w/notes.md"), tab("b", "/w/rain.md")]}
        activeTabId="a"
        onActivate={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "All Tabs" })).toHaveTextContent(
      "notes.md",
    );
    expect(screen.getByRole("button", { name: "All Tabs" })).toHaveTextContent(
      "2",
    );
  });

  it("lists every tab, the one in front ticked, and switches", () => {
    const onActivate = vi.fn();
    render(
      <TabSwitcher
        tabs={[tab("a", "/w/notes.md"), tab("b", "/w/rain.md")]}
        activeTabId="a"
        onActivate={onActivate}
        onClose={() => {}}
        onAdd={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "All Tabs" }));
    expect(screen.getByRole("menu", { name: "All Tabs" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "notes.md" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "rain.md" }));
    expect(onActivate).toHaveBeenCalledWith("b");
  });

  it("closes a tab from its ×", () => {
    const onClose = vi.fn();
    render(
      <TabSwitcher
        tabs={[tab("a", "/w/notes.md"), tab("b", "/w/rain.md")]}
        activeTabId="a"
        onActivate={() => {}}
        onClose={onClose}
        onAdd={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "All Tabs" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Close Tab" })[1]);
    expect(onClose).toHaveBeenCalledWith("b");
  });

  it("adds a tab, the row's + it does not draw", () => {
    const onAdd = vi.fn();
    render(
      <TabSwitcher
        tabs={[tab("a", "/w/notes.md")]}
        activeTabId="a"
        onActivate={() => {}}
        onClose={() => {}}
        onAdd={onAdd}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "All Tabs" }));
    fireEvent.click(screen.getByRole("button", { name: "New Tab" }));
    expect(onAdd).toHaveBeenCalled();
  });
});
