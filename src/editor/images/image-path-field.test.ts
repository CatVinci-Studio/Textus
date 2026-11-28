// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { addCompletionSource } from "../completion/sources";
import { IMAGE_PATH_FIELD_CLASS, openImagePathField } from "./image-path-field";

let removeSource: (() => void) | null = null;
afterEach(() => {
  removeSource?.();
  removeSource = null;
  document.body.replaceChildren();
});

function open(value = "pics/old.png") {
  const host = document.createElement("span");
  document.body.append(host);
  const apply = vi.fn();
  const done = vi.fn();
  openImagePathField(host, {
    value,
    label: "Edit Path",
    docPath: "/notes/a.md",
    apply,
    done,
  });
  const input = host.querySelector("input")!;
  const key = (key: string) =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  return { host, input, apply, done, key };
}

describe("Edit Path", () => {
  it("writes a changed target on Enter and goes", () => {
    const { host, input, apply, done, key } = open();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("pics/old.png");
    input.value = "  pics/new.png ";
    key("Enter");
    expect(apply).toHaveBeenCalledWith("pics/new.png");
    expect(done).toHaveBeenCalledOnce();
    expect(host.querySelector(`.${IMAGE_PATH_FIELD_CLASS}`)).toBeNull();
  });

  it("keeps the old target on Escape, unchanged or emptied", () => {
    const a = open();
    a.input.value = "pics/new.png";
    a.key("Escape");
    expect(a.apply).not.toHaveBeenCalled();
    expect(a.done).toHaveBeenCalledOnce();

    const b = open();
    b.key("Enter");
    const c = open();
    c.input.value = "   ";
    c.key("Enter");
    expect(b.apply).not.toHaveBeenCalled();
    expect(c.apply).not.toHaveBeenCalled();
  });

  it("ignores Enter and Escape while composing, and keeps them from the app", () => {
    const { input, apply, done } = open();
    const seen = vi.fn();
    document.body.addEventListener("keydown", seen);
    input.value = "pics/new.png";
    for (const key of ["Enter", "Escape"])
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key, isComposing: true, bubbles: true }),
      );
    expect(apply).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(done).toHaveBeenCalledOnce();
    expect(seen).toHaveBeenCalledTimes(2);
    document.body.removeEventListener("keydown", seen);
  });

  it("offers the folder's pictures from the picture completion's list", async () => {
    removeSource = addCompletionSource({
      id: "textus.paths.image",
      owner: "core",
      where: "text",
      pattern: /$/,
      title: () => "",
      provide: ({ path }) =>
        path === "/notes/a.md"
          ? {
              items: [{ label: "cat 1.png", insert: "(cat%201.png)" }],
              complete: true,
            }
          : null,
    });
    const { host } = open();
    await vi.waitFor(() =>
      expect(
        Array.from(host.querySelectorAll("option")).map((o) => o.value),
      ).toEqual(["cat%201.png"]),
    );
  });
});
