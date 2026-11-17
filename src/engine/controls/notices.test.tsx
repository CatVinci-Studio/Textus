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

it("keeps an error and an offer to undo through a burst of plain notes", () => {
  const { container } = render(<NoticeHost />);
  act(() => {
    showNotice("Couldn't save notes.md.", { tone: "error" });
    showNotice("Moved to the trash.", {
      action: { label: "Undo", run: () => {} },
    });
    for (let i = 0; i < 5; i++) showNotice(`Plugin note ${i}`);
  });
  const shown = [...container.querySelectorAll(".notice")].map(
    (n) => n.textContent,
  );
  expect(shown.join("|")).toContain("Couldn't save");
  expect(shown.join("|")).toContain("Moved to the trash.");
  expect(shown).toHaveLength(3);
});
