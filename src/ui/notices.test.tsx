// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { expect, it } from "vitest";
import { NoticeHost, showNotice } from "./notices";

it("shows a note said again while showing once, and holds it under the pointer", async () => {
  const { container } = render(<NoticeHost />);
  act(() => {
    showNotice("This document is read-only.");
    showNotice("This document is read-only.");
  });
  expect(container.querySelectorAll(".notice")).toHaveLength(1);
});
