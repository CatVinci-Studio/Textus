// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeSample } from "./ThemeSample";

const load = vi.hoisted(() => vi.fn());
vi.mock("../../platform/ipc", () => ({ themes: { loadThemeCss: load } }));

afterEach(() => {
  cleanup();
  load.mockReset();
});

const CSS = `body { background: #fdf6e3; color: #586e75; }
  #write h1 { font-family: "Playfair Display", serif; }
  #write a { color: #b58900; }
  body::before { content: "injected"; }`;

describe("ThemeSample", () => {
  it("draws the theme's values without putting its CSS on the page", async () => {
    load.mockResolvedValue(CSS);
    const before = document.querySelectorAll("style").length;
    const { container } = render(
      <ThemeSample id="t1" hasDark={false} dark={false} />,
    );
    const sample = container.firstElementChild as HTMLElement;
    await waitFor(() =>
      expect(sample.style.getPropertyValue("--sample-bg")).toBe("#fdf6e3"),
    );
    expect(sample.style.getPropertyValue("--sample-text")).toBe("#586e75");
    expect(sample.style.getPropertyValue("--sample-accent")).toBe("#b58900");
    expect(sample.style.getPropertyValue("--sample-font")).toBe(
      '"Playfair Display", serif',
    );
    expect(document.querySelectorAll("style").length).toBe(before);
  });

  it("asks for the dark design only of a theme that has one", async () => {
    load.mockResolvedValue("");
    render(<ThemeSample id="a" hasDark dark />);
    render(<ThemeSample id="b" hasDark={false} dark />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load).toHaveBeenCalledWith("a", "dark");
    expect(load).toHaveBeenCalledWith("b", "light");
  });

  it("keeps the current look for a theme that sets nothing", async () => {
    load.mockResolvedValue("#write h3 { margin: 0 }");
    const { container } = render(
      <ThemeSample id="t" hasDark={false} dark={false} />,
    );
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(
      (container.firstElementChild as HTMLElement).getAttribute("style"),
    ).toBeFalsy();
  });
});
