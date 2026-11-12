// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { ListRowIcon } from "./list-row-icon";

it("draws a named icon as the app's, and any other text as the row's glyph", () => {
  const named = render(<ListRowIcon icon="file" />).container;
  expect(named.querySelector("svg.plugin-list-icon")).not.toBeNull();
  const glyph = render(<ListRowIcon icon="🔎" />).container;
  expect(glyph.querySelector(".plugin-list-icon.is-glyph")?.textContent).toBe("🔎");
});
