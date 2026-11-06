// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useCloseOnOutsideClick } from "./useCloseOnOutsideClick";

function Probe({ onClose }: { onClose: () => void }) {
  useCloseOnOutsideClick(onClose, true, true, ".note");
  return (
    <div>
      <div className="note">note</div>
      <div className="away">away</div>
    </div>
  );
}

it("closes on a press outside the elements named inside, and on Escape unless composing", async () => {
  const onClose = vi.fn();
  const { container } = render(<Probe onClose={onClose} />);
  await act(() => new Promise((r) => setTimeout(r, 0)));
  const press = (el: Element) =>
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  press(container.querySelector(".note")!);
  expect(onClose).not.toHaveBeenCalled();
  press(container.querySelector(".away")!);
  expect(onClose).toHaveBeenCalledTimes(1);
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", isComposing: true }),
  );
  expect(onClose).toHaveBeenCalledTimes(1);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(onClose).toHaveBeenCalledTimes(2);
});
