// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActionSheet } from "./ActionSheet";
import { SettingsProvider } from "../../prefs/SettingsContext";

describe("ActionSheet", () => {
  afterEach(cleanup);

  it("tells the choice before it closes, so a close meaning 'nothing chosen' doesn't win", () => {
    // As a plugin page's menu answers: the first answer wins.
    let answer: string | null | undefined;
    const settle = (value: string | null) => {
      if (answer === undefined) answer = value;
    };
    render(
      <SettingsProvider>
        <ActionSheet
          items={[{ label: "Delete", onSelect: () => settle("delete") }]}
          onClose={() => settle(null)}
        />
      </SettingsProvider>,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(answer).toBe("delete");
  });
});
