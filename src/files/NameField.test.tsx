// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NameField, stemEnd } from "./NameField";

vi.mock("../engine/controls/app-dialog", () => ({ showMessage: vi.fn() }));

afterEach(cleanup);

it("selects a file's name without its extension, a folder's whole", () => {
  expect(stemEnd("plan.md", false)).toBe(4);
  expect(stemEnd("v1.2 notes.md", false)).toBe(10);
  expect(stemEnd(".gitignore", false)).toBe(10);
  expect(stemEnd("my.photos", true)).toBe(9);
  const { getByRole } = render(
    <NameField
      initial="plan.md"
      isDir={false}
      label="Name"
      commit={async () => null}
      cancel={() => {}}
    />,
  );
  const input = getByRole("textbox") as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
});

it("says a taken name under the field after Enter and stays; Escape gives up", async () => {
  const commit = vi.fn(async (name: string) =>
    name === "taken.md"
      ? "There is already something named “taken.md” here."
      : null,
  );
  const cancel = vi.fn();
  const { getByRole, queryByRole } = render(
    <NameField
      initial="plan.md"
      isDir={false}
      label="Name"
      commit={commit}
      cancel={cancel}
    />,
  );
  const input = getByRole("textbox");
  fireEvent.change(input, { target: { value: "taken.md" } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  expect(getByRole("alert").textContent).toContain("taken.md");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  // Typing on clears it; another name goes through.
  fireEvent.change(input, { target: { value: "free.md" } });
  expect(queryByRole("alert")).toBeNull();
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  expect(commit).toHaveBeenLastCalledWith("free.md", true);
  expect(cancel).not.toHaveBeenCalled();
});

it("gives up on Escape, or on the name unchanged, but a new entry's default is given", async () => {
  const commit = vi.fn(async () => null);
  const cancel = vi.fn();
  const field = (fresh: boolean) =>
    render(
      <NameField
        initial="Untitled"
        isDir
        fresh={fresh}
        label="Name"
        commit={commit}
        cancel={cancel}
      />,
    );
  const one = field(false);
  await act(async () => {
    fireEvent.keyDown(one.getByRole("textbox"), { key: "Enter" });
  });
  expect(cancel).toHaveBeenCalledOnce();
  one.unmount();
  const two = field(true);
  await act(async () => {
    fireEvent.keyDown(two.getByRole("textbox"), { key: "Enter" });
  });
  expect(commit).toHaveBeenCalledWith("Untitled", true);
  two.unmount();
  const three = field(false);
  fireEvent.change(three.getByRole("textbox"), { target: { value: "Other" } });
  fireEvent.keyDown(three.getByRole("textbox"), { key: "Escape" });
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(commit).toHaveBeenCalledOnce();
});
