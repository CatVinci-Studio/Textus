// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const moves: { el: Element; frames: Keyframe[] }[] = [];
vi.mock("./motion", () => ({
  motionAllowed: () => true,
  length: () => 4,
  animate: (el: Element, frames: Keyframe[]) => {
    moves.push({ el, frames });
    return null;
  },
}));
const { RowsMakeRoom, makeRoomFor } = await import("./RowsMakeRoom");

/** jsdom lays nothing out: each row is 20 px tall, one under another, and a
 *  hidden one takes no room. */
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const rows = [...document.querySelectorAll("li")].filter(
        (li) => !li.closest("[hidden]"),
      );
      // A closed <details> in WebKit: its body unseen, at its open place.
      const unseen = !!this.closest("[hidden][data-unseen]");
      const i = unseen ? 1 : rows.indexOf(this as HTMLLIElement);
      const top = i * 20;
      return (
        i < 0
          ? { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
          : {
              top,
              bottom: top + 20,
              left: 0,
              right: 100,
              width: 100,
              height: 20,
            }
      ) as DOMRect;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  moves.length = 0;
});

function List({ open }: { open: boolean }) {
  const root = useRef<HTMLUListElement>(null);
  return (
    <ul ref={root}>
      <RowsMakeRoom watch={open} root={() => root.current} rows="li" />
      <li>folder</li>
      {open && <li>inside a</li>}
      {open && <li>inside b</li>}
      <li>after</li>
    </ul>
  );
}

const moveOf = (text: string) =>
  moves.find((m) => m.el.textContent === text)?.frames[0];

describe("RowsMakeRoom", () => {
  it("opened, the rows below glide down from where they were and the new rows come in", async () => {
    const { rerender } = render(<List open={false} />);
    rerender(<List open />);
    await act(async () => {});
    // "after" stood at 20 and now lies at 60: it starts 40 px up.
    expect(moveOf("after")).toEqual({ transform: "translate(0px, -40px)" });
    for (const text of ["inside a", "inside b"])
      expect(moveOf(text)).toEqual({
        opacity: 0,
        transform: "translateY(-4px)",
      });
    expect(moveOf("folder")).toBeUndefined();
  });

  it("folded, the rows below glide up", async () => {
    const { rerender } = render(<List open />);
    rerender(<List open={false} />);
    await act(async () => {});
    expect(moveOf("after")).toEqual({ transform: "translate(0px, 40px)" });
  });

  it("a list filling for the first time just appears", async () => {
    function Filling({ rows }: { rows: string[] | null }) {
      const root = useRef<HTMLUListElement>(null);
      return (
        <ul ref={root}>
          <RowsMakeRoom
            watch={rows ? rows.length : null}
            root={() => root.current}
            rows="li"
          />
          {rows?.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      );
    }
    const { rerender } = render(<Filling rows={null} />);
    rerender(<Filling rows={["a", "b"]} />);
    await act(async () => {});
    expect(moves).toEqual([]);
  });
});

describe("makeRoomFor", () => {
  it("rows a closed fold laid out unseen come in as it opens", () => {
    const root = document.createElement("ul");
    root.innerHTML =
      "<li>summary</li><div hidden data-unseen><li>body</li></div><li>after</li>";
    document.body.append(root);
    const body = root.querySelector("div")!;
    Object.defineProperty(Element.prototype, "checkVisibility", {
      configurable: true,
      value(this: Element) {
        return !this.closest("[hidden]");
      },
    });
    makeRoomFor(root, "li", () => {
      body.hidden = false;
    });
    expect(moveOf("body")).toEqual({
      opacity: 0,
      transform: "translateY(-4px)",
    });
    expect(moveOf("after")).toEqual({ transform: "translate(0px, -20px)" });
    root.remove();
    delete (Element.prototype as { checkVisibility?: unknown }).checkVisibility;
  });
});
