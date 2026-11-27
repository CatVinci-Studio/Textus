// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import en from "../i18n/locales/en";
import { HeadingMatches } from "./HeadingMatches";

const goToHeading = vi.fn();
vi.mock("./outline-current", () => ({
  goToHeading: (tab: string, index: number) => goToHeading(tab, index),
}));
vi.mock("../prefs/SettingsContext", () => ({ useSettings: () => ({ t: en }) }));

afterEach(cleanup);

const doc = "# Walk notes\n\n## Morning\n\ntext\n\n## **Noon** by the river\n";

it("lists the document's headings that match, and jumps to one", () => {
  render(<HeadingMatches content={doc} tabId="t1" query="noon" />);
  expect(screen.getByText(en.searchHeadingsHeading)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Noon by the river" }));
  expect(goToHeading).toHaveBeenCalledWith("t1", 2);
});

it("shows nothing when no heading matches", () => {
  const { container } = render(
    <HeadingMatches content={doc} tabId="t1" query="evening" />,
  );
  expect(container.textContent).toBe("");
});
