// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { usePushedSidebar } from "../../mobile/usePushedSidebar";
import { useNarrowSidebar } from "./useNarrowSidebar";

/** Records, in a layout effect that runs after the host's (a later
 *  sibling), what `seen` says: a passive effect has not run by then, so a
 *  change made only after paint reads as not yet made. */
function Probe({ seen, log }: { seen: () => unknown; log: unknown[] }) {
  useLayoutEffect(() => {
    log.push(seen());
  });
  return null;
}

describe("the sidebar across a layout change, before paint", () => {
  it("puts a phone's sidebar away as the window turns into a phone's", () => {
    const setOpen = vi.fn();
    const log: unknown[] = [];
    const Host = ({ phone }: { phone: boolean }) => {
      usePushedSidebar(phone, true, setOpen, "a");
      return null;
    };
    const tree = (phone: boolean) => (
      <>
        <Host phone={phone} />
        <Probe seen={() => setOpen.mock.calls.length} log={log} />
      </>
    );
    const { rerender } = render(tree(false));
    rerender(tree(true));
    expect(log).toEqual([0, 1]);
  });

  it("steps the sidebar aside as the window narrows past it", () => {
    const setOpen = vi.fn();
    const log: unknown[] = [];
    const Host = ({ room }: { room: number }) => {
      useNarrowSidebar(true, setOpen, room, 300);
      return null;
    };
    const tree = (room: number) => (
      <>
        <Host room={room} />
        <Probe seen={() => setOpen.mock.calls.length} log={log} />
      </>
    );
    const { rerender } = render(tree(1000));
    rerender(tree(200));
    expect(log).toEqual([0, 1]);
  });
});
