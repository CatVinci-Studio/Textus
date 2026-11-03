// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NumberStepper } from "./NumberStepper";

afterEach(cleanup);

const labels = {
  label: "Text size",
  unset: "Theme's",
  decrease: "Decrease",
  increase: "Increase",
  reset: "Use the theme's",
};

function setup(start: number | null) {
  const changes: (number | null)[] = [];
  function Host() {
    const [value, setValue] = useState(start);
    return (
      <NumberStepper
        value={value}
        range={{ min: 10, max: 48, step: 1 }}
        unit="px"
        from={() => 16.5}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
        labels={labels}
      />
    );
  }
  render(<Host />);
  return { changes, field: screen.getByRole("spinbutton") };
}

describe("a number stepper", () => {
  it("shows the theme's value dimmed while unset, and steps from it", () => {
    const { changes, field } = setup(null);
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", "17");
    expect(field).toHaveAttribute("aria-valuetext", "Theme's, 17 px");
    expect(screen.queryByRole("button", { name: labels.reset })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Increase" }));
    expect(changes).toEqual([18]);
    expect(field).toHaveValue("18");
  });

  it("commits what is typed on Enter, kept in range", () => {
    const { changes, field } = setup(16);
    fireEvent.change(field, { target: { value: "99" } });
    expect(changes).toEqual([]);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(changes).toEqual([48]);
    expect(field).toHaveValue("48");
    expect(screen.getByRole("button", { name: "Increase" })).toBeDisabled();
  });

  it("goes back to unset when the field is emptied or reset", () => {
    const { changes, field } = setup(20);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(changes).toEqual([null]);
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(changes).toEqual([null, 18]);
    fireEvent.click(screen.getByRole("button", { name: labels.reset }));
    expect(changes).toEqual([null, 18, null]);
  });

  it("keeps the value when what is typed is not a number", () => {
    const { changes, field } = setup(20);
    fireEvent.change(field, { target: { value: "big" } });
    fireEvent.blur(field);
    expect(changes).toEqual([]);
    expect(field).toHaveValue("20");
  });

  it("steps from what is typed, and Escape undoes only the typing", () => {
    const { changes, field } = setup(20);
    fireEvent.change(field, { target: { value: "30" } });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(changes).toEqual([29]);
    fireEvent.change(field, { target: { value: "12" } });
    // What a dialog around it sees: an Escape already taken.
    const escape = vi.fn();
    const listen = (e: KeyboardEvent) => escape(e.defaultPrevented);
    document.addEventListener("keydown", listen);
    fireEvent.keyDown(field, { key: "Escape" });
    document.removeEventListener("keydown", listen);
    expect(escape).toHaveBeenCalledWith(true);
    expect(field).toHaveValue("29");
    expect(changes).toEqual([29]);
  });
});
