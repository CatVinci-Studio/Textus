// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

afterEach(cleanup);

// A conditional option that renders nothing, as `{cond && <option/>}` does.
const showHidden: boolean = Math.random() > 2;

function renderSelect(value = "b") {
  const onChange = vi.fn();
  const onOuterKey = vi.fn();
  render(
    <div onKeyDown={(e) => onOuterKey(e.key)}>
      <Select value={value} onChange={onChange} aria-label="Letter">
        <option value="a">Alpha</option>
        <>
          <option value="b">Bravo</option>
          {showHidden && <option value="x">Hidden</option>}
        </>
        <option value="c">Charlie</option>
      </Select>
    </div>,
  );
  return { onChange, onOuterKey };
}

describe("Select", () => {
  it("shows the chosen option and picks another by click", () => {
    const { onChange } = renderSelect();
    const trigger = screen.getByRole("combobox", { name: "Letter" });
    expect(trigger).toHaveTextContent("Bravo");
    fireEvent.click(trigger);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: "Bravo" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("option", { name: "Charlie" }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: "c" } });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("works from the keyboard, and Escape closes only the list", () => {
    const { onChange, onOuterKey } = renderSelect();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ target: { value: "c" } });

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    // The dialog around a select must not hear that Escape.
    expect(onOuterKey).not.toHaveBeenCalledWith("Escape");
  });

  it("closes on a press outside, without choosing", () => {
    const { onChange } = renderSelect();
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes on a scroll that moves it, not on one that arrives late", () => {
    renderSelect();
    const trigger = screen.getByRole("combobox");
    let top = 100;
    trigger.getBoundingClientRect = () =>
      ({ top, left: 20, bottom: top + 30, right: 120, width: 100 }) as DOMRect;
    fireEvent.click(trigger);
    // The event of a scroll made before the list opened: the trigger is
    // where the list was placed, so the list stays.
    fireEvent.scroll(document.body);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    top = 40;
    fireEvent.scroll(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("lists <optgroup>s under their names, and says the group when closed", () => {
    const onChange = vi.fn();
    render(
      <Select value="fiction" onChange={onChange} aria-label="Conventions">
        <option value="auto">Automatic</option>
        <optgroup label="English">
          <option value="news">News</option>
          <option value="fiction">Fiction</option>
        </optgroup>
      </Select>,
    );
    const trigger = screen.getByRole("combobox", { name: "Conventions" });
    expect(trigger).toHaveTextContent("English · Fiction");
    fireEvent.click(trigger);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByText("English")).toHaveClass("ui-select-group");
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ target: { value: "news" } });
  });
});
