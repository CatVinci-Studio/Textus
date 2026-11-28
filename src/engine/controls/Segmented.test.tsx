// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Segmented } from "./Segmented";

const OPTIONS = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

afterEach(cleanup);

describe("Segmented", () => {
  it("steps arrow presses from the segment the keys are on, not from a value the owner has not committed yet", () => {
    // An owner that commits later (a cross-fade): the value stays as it was.
    const onChange = vi.fn();
    render(
      <Segmented
        options={OPTIONS}
        value="light"
        onChange={onChange}
        label="Mode"
        kind="choice"
      />,
    );
    screen.getByRole("radio", { name: "Light" }).focus();
    for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft"])
      fireEvent.keyDown(document.activeElement!, { key });
    // Light → Dark → System → Dark.
    expect(onChange.mock.calls.map(([id]) => id)).toEqual([
      "dark",
      "system",
      "dark",
    ]);
    expect(document.activeElement?.getAttribute("data-segment")).toBe("dark");
  });

  it("still follows the value when it is chosen elsewhere", () => {
    function Owner() {
      const [value, setValue] = useState("light");
      return (
        <Segmented
          options={OPTIONS}
          value={value}
          onChange={setValue}
          label="Mode"
          kind="choice"
        />
      );
    }
    render(<Owner />);
    screen.getByRole("radio", { name: "Light" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(
      screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked"),
    ).toBe("true");
  });
});
