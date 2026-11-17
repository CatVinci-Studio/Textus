// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../platform/capabilities", async (load) => ({
  ...(await load<object>()),
  isMobileApp: true,
}));
const { Select } = await import("./Select");

afterEach(cleanup);

it("on a tablet, a Select's button pressed again closes its menu", () => {
  render(
    <Select value="a" onChange={() => {}} aria-label="Letter">
      <option value="a">Alpha</option>
      <option value="b">Bravo</option>
    </Select>,
  );
  const button = screen.getByRole("button", { name: "Letter" });
  fireEvent.click(button);
  expect(screen.queryByRole("menu")).not.toBeNull();
  // As a tap gives it: the press, then the click, on the button.
  fireEvent.pointerDown(button);
  fireEvent.mouseDown(button);
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("false");
});
