// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NumberField } from "./NumberField";

afterEach(cleanup);

function field(value: number | null, onChange = vi.fn()) {
  render(
    <NumberField
      value={value}
      placeholder={1.25}
      min={1}
      max={1.6}
      step={0.02}
      label="Scale"
      decreaseLabel="Less"
      increaseLabel="More"
      onChange={onChange}
    />,
  );
  return { input: screen.getByRole("textbox", { name: "Scale" }), onChange };
}

describe("NumberField", () => {
  it("keeps a typed value as typed, inside the range", () => {
    const { input, onChange } = field(null);
    fireEvent.change(input, { target: { value: "1.25" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(1.25);
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(1.6);
  });

  it("is not set when emptied, its placeholder what applies", () => {
    const { input, onChange } = field(1.3);
    expect(input.getAttribute("placeholder")).toBe("1.25");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("steps along the grid from the placeholder when not set", () => {
    const { onChange } = field(null);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(onChange).toHaveBeenLastCalledWith(1.28);
  });
});
