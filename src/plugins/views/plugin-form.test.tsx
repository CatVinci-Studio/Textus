// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PluginFormHost, showPluginForm } from "./plugin-form";
import { monthDays } from "./plugin-form-fields";

afterEach(cleanup);

const ask = (type: "date" | "color", value: string) => {
  render(<PluginFormHost />);
  let answer!: Promise<Record<string, unknown> | null>;
  act(() => {
    answer = showPluginForm({
      title: "Pick",
      okLabel: "OK",
      cancelLabel: "Cancel",
      fields: [{ key: "v", type, label: "", value }],
    });
  });
  return answer;
};

describe("a form's date and colour fields", () => {
  it("lay a month out Monday first, six weeks", () => {
    const days = monthDays(new Date(2026, 10, 1));
    expect(days).toHaveLength(42);
    expect(days[0].getDay()).toBe(1);
    expect(days[0].getDate()).toBe(26);
  });

  it("give the day picked on the calendar", async () => {
    const answer = ask("date", "2026-11-08");
    fireEvent.click(screen.getByRole("button", { name: "2026-11-20" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(await answer).toEqual({ v: "2026-11-20" });
  });

  it("give the colour picked, or typed", async () => {
    const answer = ask("color", "");
    fireEvent.change(screen.getByPlaceholderText("#rrggbb"), {
      target: { value: "#123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(await answer).toEqual({ v: "#123456" });
  });
});
