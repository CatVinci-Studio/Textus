// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import { ai } from "../../platform/ipc";
import { AvailableSkills } from "./market-skills";

vi.mock("../../prefs/SettingsContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../prefs/SettingsContext")>()),
  useSettings: () => ({ settings: { language: "en" }, setSettings: vi.fn() }),
}));

const t = resolveStrings("en");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AvailableSkills", () => {
  // #512: a catalog that can't be fetched said "Loading…" for ever.
  it("says why when the catalog can't be fetched, with a retry", async () => {
    vi.spyOn(ai, "listSkills").mockResolvedValue([]);
    render(
      <AvailableSkills
        t={t}
        catalog={{ status: "failed", error: "no route to host" }}
        query=""
      />,
    );
    expect(
      await screen.findByText(
        t.pluginsCatalogFailed.replace("{reason}", "no route to host"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t.pluginsCatalogRetry }),
    ).toBeInTheDocument();
    expect(screen.queryByText(t.pluginsCatalogLoading)).toBeNull();
  });
});
