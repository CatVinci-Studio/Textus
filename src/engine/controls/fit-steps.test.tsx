// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStackWhenTall } from "./fit-steps";

// jsdom has no layout or ResizeObserver: each element's box is given.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function box(top: number, height: number) {
  return { offsetTop: top, offsetHeight: height };
}

function Row({ lines }: { lines: number }) {
  const row = useRef<HTMLDivElement>(null);
  useStackWhenTall(row, ".label");
  return (
    <div ref={row} data-testid="row">
      <div className="label" data-lines={lines}>
        Design aus einer CSS-Datei hinzufügen
      </div>
      <button>Datei wählen…</button>
    </div>
  );
}

describe("useStackWhenTall", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function layout() {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      lineHeight: "20px",
      fontSize: "16px",
    } as CSSStyleDeclaration);
    const dims = (el: HTMLElement) =>
      el.classList.contains("label")
        ? box(0, Number(el.dataset.lines) * 20)
        : box(10, 30);
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
      function (this: HTMLElement) {
        return dims(this).offsetTop;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return dims(this).offsetHeight;
      },
    );
  }

  it("puts the control under a name that runs past two lines beside it", () => {
    layout();
    const { getByTestId } = render(<Row lines={3} />);
    expect(getByTestId("row").hasAttribute("data-stacked")).toBe(true);
  });

  it("keeps a two-line name beside its control", () => {
    layout();
    const { getByTestId } = render(<Row lines={2} />);
    expect(getByTestId("row").hasAttribute("data-stacked")).toBe(false);
  });
});
