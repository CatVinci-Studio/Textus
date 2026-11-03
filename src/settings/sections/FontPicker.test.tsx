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

const fonts = [
  { name: "Georgia", local: {} },
  { name: "SimSun", local: { zh: "宋体" } },
  ...Array.from({ length: 300 }, (_, i) => ({
    name: `Filler ${String(i).padStart(3, "0")}`,
    local: {},
  })),
].sort((a, b) => a.name.localeCompare(b.name));

vi.mock("../../platform/ipc", async (original) => ({
  ...(await original<typeof import("../../platform/ipc")>()),
  systemIpc: { fontFamilies: () => Promise.resolve(fonts) },
}));

// Recent fonts are kept in ui-state.json, which only the native side has.
const uiState = new Map<string, unknown>();
vi.mock("../../storage/ui-state", () => ({
  getUiState: (key: string) => uiState.get(key),
  setUiState: (key: string, value: unknown) => uiState.set(key, value),
}));

const { FontPicker } = await import("./FontPicker");

const labels = {
  label: "Text font",
  auto: "Theme's",
  search: "Search fonts",
  recent: "Recently used",
  all: "All fonts",
  none: "No font has that name",
};

afterEach(() => {
  cleanup();
  uiState.clear();
});

async function setup(value = "") {
  const onChange = vi.fn();
  render(
    <FontPicker value={value} onChange={onChange} lang="zh" labels={labels} />,
  );
  // The list arrives from the native side.
  await act(() => Promise.resolve());
  fireEvent.click(screen.getByRole("combobox", { name: "Text font" }));
  return { onChange, search: screen.getByRole("textbox") };
}

describe("the text font picker", () => {
  it("draws only the rows near the view, not every font", async () => {
    await setup();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Theme's");
    expect(options.length).toBeLessThan(30);
  });

  it("finds a font by its Chinese name and chooses it with Enter", async () => {
    const { onChange, search } = await setup();
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "宋" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "宋体SimSun",
    ]);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("SimSun");
    expect(uiState.get("recentFonts")).toEqual(["SimSun"]);
  });

  it("puts the fonts chosen lately first, and skips headings with the arrows", async () => {
    uiState.set("recentFonts", ["Georgia"]);
    const { onChange, search } = await setup();
    expect(screen.getByText("Recently used")).toBeInTheDocument();
    // Theme's, then past the heading to Georgia.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Georgia");
  });

  it("closes on Escape without letting it reach the dialog around it", async () => {
    const { search } = await setup("Georgia");
    const outer = vi.fn();
    const listen = (e: KeyboardEvent) => outer(e.defaultPrevented);
    document.addEventListener("keydown", listen);
    fireEvent.keyDown(search, { key: "Escape" });
    document.removeEventListener("keydown", listen);
    expect(outer).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Text font" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
