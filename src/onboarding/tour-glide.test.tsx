// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { useGlide, type TourFrame } from "./tour-glide";

const frame: TourFrame = { hole: null, card: { left: 40, top: 60 } };

describe("the tour card's first place", () => {
  it("is drawn before paint, never shown at the window's corner", () => {
    const draw = vi.fn();
    const drawnBeforePaint: number[] = [];
    const Host = () => {
      useGlide(frame, draw);
      return null;
    };
    const Probe = () => {
      useLayoutEffect(() => {
        drawnBeforePaint.push(draw.mock.calls.length);
      });
      return null;
    };
    render(
      <>
        <Host />
        <Probe />
      </>,
    );
    expect(drawnBeforePaint).toEqual([1]);
    expect(draw).toHaveBeenCalledWith(frame);
  });

  it("waits for the card to be measured, not drawing a guess", () => {
    const draw = vi.fn();
    const Host = ({ ready }: { ready: boolean }) => {
      useGlide(frame, draw, ready);
      return null;
    };
    const { rerender } = render(<Host ready={false} />);
    expect(draw).not.toHaveBeenCalled();
    rerender(<Host ready />);
    expect(draw).toHaveBeenCalledTimes(1);
  });
});
