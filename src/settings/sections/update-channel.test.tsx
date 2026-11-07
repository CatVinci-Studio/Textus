// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import { updater } from "../../platform/ipc";
import { selfUpdateAllowed } from "../../platform/distribution";
import { appVersion } from "../../platform/app-info";
import { UpdateChannelRow } from "./general";

vi.mock("../../platform/capabilities", async (original) => ({
  ...(await original<object>()),
  canAutoUpdate: true,
}));
vi.mock("../../platform/distribution", () => ({
  selfUpdateAllowed: vi.fn(),
  checkChannel: vi.fn(),
}));
vi.mock("../../platform/app-info", () => ({
  appVersion: vi.fn(),
  relaunchApp: vi.fn(),
}));
vi.mock("../../platform/ipc", () => ({
  cli: {},
  defaultEditor: {},
  updater: { check: vi.fn() },
}));
const settings = { updateChannel: "stable" };
vi.mock("../../prefs/SettingsContext", () => ({
  useSettings: () => ({ settings, setSettings: vi.fn() }),
}));

const t = resolveStrings("en");
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  settings.updateChannel = "stable";
});

/** The row in a build that may (or, from a package manager, may not)
 *  install its own updates, at `version`. */
function row(selfUpdate: boolean, version: string) {
  vi.mocked(selfUpdateAllowed).mockResolvedValue(selfUpdate);
  vi.mocked(appVersion).mockResolvedValue(version);
  return render(<UpdateChannelRow t={t} />);
}

describe("the update channel row", () => {
  it("offers a beta on Stable the way back, and says when there is none", async () => {
    vi.mocked(updater.check).mockResolvedValue(null);
    row(true, "1.3.0-beta.1");
    fireEvent.click(
      await screen.findByRole("button", { name: t.backToStableButton }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      t.backToStableNone,
    );
    expect(updater.check).toHaveBeenCalledWith("stable", true);
  });

  it("offers no way back on Beta, or to a stable install", async () => {
    settings.updateChannel = "beta";
    row(true, "1.3.0-beta.1");
    expect(
      await screen.findByRole("combobox", { name: t.updateChannelLabel }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: t.backToStableButton }),
    ).toBeNull();
    cleanup();

    settings.updateChannel = "stable";
    row(true, "1.2.1");
    await screen.findByRole("combobox", { name: t.updateChannelLabel });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      screen.queryByRole("button", { name: t.backToStableButton }),
    ).toBeNull();
  });

  it("is not there in a package-manager build", async () => {
    const { container } = row(false, "1.3.0");
    await vi.waitFor(() => expect(selfUpdateAllowed).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
