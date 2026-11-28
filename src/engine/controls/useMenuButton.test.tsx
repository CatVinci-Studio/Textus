// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMenuButton } from "./useMenuButton";

afterEach(cleanup);

function More({ onSelect }: { onSelect: () => void }) {
  const { button, menu } = useMenuButton(() => [
    { label: "Rename", onSelect },
    { label: "Delete", onSelect: () => {} },
  ]);
  return (
    <>
      <button type="button" {...button}>
        More
      </button>
      {menu}
    </>
  );
}

const mouse = { pointerType: "mouse", button: 0, clientX: 5, clientY: 5 };

describe("useMenuButton", () => {
  it("opens on the mouse's press; that press's click leaves it open", () => {
    render(<More onSelect={() => {}} />);
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.pointerDown(more, mouse);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(more);
    fireEvent.click(more, { detail: 1 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(more, mouse);
    fireEvent.click(more, { detail: 1 });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("held and let go over an item, chooses it", () => {
    const onSelect = vi.fn();
    render(<More onSelect={onSelect} />);
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    try {
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "More" }),
        mouse,
      );
      now.mockReturnValue(1500);
      fireEvent.pointerUp(
        screen.getByRole("menuitem", { name: "Rename" }),
        mouse,
      );
      expect(onSelect).toHaveBeenCalledOnce();
      expect(screen.queryByRole("menu")).toBeNull();
    } finally {
      now.mockRestore();
    }
  });

  it("opens for a finger and the keys on the click, as before", () => {
    render(<More onSelect={() => {}} />);
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.pointerDown(more, { ...mouse, pointerType: "touch" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(more, { detail: 1 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(more, { detail: 0 });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
