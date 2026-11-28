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
    // The group's name heads its options, and is not one to pick.
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "English" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ target: { value: "news" } });
  });

  it("opens on the mouse's press; that press's click leaves it open", () => {
    const { onChange } = renderSelect();
    const trigger = screen.getByRole("combobox");
    fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.pointerUp(trigger, { pointerType: "mouse" });
    fireEvent.click(trigger, { detail: 1 });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // The next press closes it, its click too leaving it so.
    fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 });
    fireEvent.click(trigger, { detail: 1 });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("held and let go over an option, chooses it; let go at once in place, chooses nothing", () => {
    const { onChange } = renderSelect();
    const trigger = screen.getByRole("combobox");
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    try {
      const press = {
        pointerType: "mouse",
        button: 0,
        clientX: 30,
        clientY: 10,
      };
      fireEvent.pointerDown(trigger, press);
      fireEvent.pointerUp(screen.getByRole("option", { name: "Alpha" }), press);
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      fireEvent.pointerDown(trigger, press);
      fireEvent.pointerDown(trigger, press);
      now.mockReturnValue(1400);
      fireEvent.pointerUp(
        screen.getByRole("option", { name: "Charlie" }),
        press,
      );
      expect(onChange).toHaveBeenCalledWith({ target: { value: "c" } });
      expect(screen.queryByRole("listbox")).toBeNull();
    } finally {
      now.mockRestore();
    }
  });

  it("opens for a finger on its click, as before", () => {
    renderSelect();
    const trigger = screen.getByRole("combobox");
    fireEvent.pointerDown(trigger, { pointerType: "touch", button: 0 });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(trigger, { detail: 1 });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});
