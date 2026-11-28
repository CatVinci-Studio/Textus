// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en";
import { GeneralPage } from "./GeneralPage";
import type { SettingsPageProps } from "./types";
import {
  findEntryElement,
  harvestPage,
  matchEntries,
} from "../settings-search";

// A desktop with everything: the page shows each group it can have.
vi.mock("../../platform/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  canDropFilesIntoTree: true,
  canTrashFiles: true,
  canInstallCliCommand: true,
  canSetDefaultEditor: true,
  canUseWindows: true,
}));
// Their own checks of the system (a tray, the default editor, the CLI) are
// not under test here.
vi.mock("../sections/general", () => ({
  CliCommandSection: () => <div className="settings-row">Install CLI</div>,
  DefaultEditorSection: () => (
    <div className="settings-row">Default editor</div>
  ),
}));
vi.mock("../sections/background", () => ({
  BackgroundSection: () => <div className="settings-row">Background</div>,
}));

vi.mock("../../prefs/SettingsContext", () => ({
  useSettings: () => ({ settings: { language: "en" }, t: en }),
}));

afterEach(cleanup);

function draw(settings: Record<string, unknown> = {}) {
  render(
    <GeneralPage
      {...({
        t: en,
        settings: {
          language: "en",
          enableDraftRecovery: true,
          keepUnsavedOnClose: false,
          proxyType: "system",
          ...settings,
        },
        setSettings: () => {},
      } as unknown as SettingsPageProps)}
    />,
  );
}

const group = (title: string) =>
  within(screen.getByRole("region", { name: title }));

it("orders its groups Basics, Startup and closing, Files, System, then Advanced", () => {
  draw();
  const titles = [
    ...document.querySelectorAll(
      ".settings-group-title, .settings-advanced > summary",
    ),
  ].map((el) => el.textContent);
  expect(titles).toEqual([
    en.generalBasicsLabel,
    en.generalOpenCloseLabel,
    en.settingsFilesGroup,
    en.generalSystemLabel,
    en.agentAdvancedGroupLabel,
  ]);
  expect(en.generalOpenCloseLabel).toBe("Startup and closing");
  expect(en.generalSystemLabel).toBe("System");
});

it("holds the two draft-recovery switches in Files, the second only while the first is on", () => {
  draw();
  const files = group(en.settingsFilesGroup);
  expect(files.getByText(en.privacyDraftRecoveryToggle)).toBeTruthy();
  expect(files.getByText(en.privacyKeepUnsavedToggle)).toBeTruthy();
  cleanup();
  draw({ enableDraftRecovery: false });
  expect(screen.getByText(en.privacyDraftRecoveryToggle)).toBeTruthy();
  expect(screen.queryByText(en.privacyKeepUnsavedToggle)).toBeNull();
});

it("folds the proxy and the file tree's two questions into one Advanced fold, one level deep", () => {
  draw();
  const fold = document.querySelector<HTMLElement>(".settings-advanced")!;
  const inFold = within(fold);
  expect(inFold.getByText(en.proxyLabel)).toBeTruthy();
  expect(inFold.getByText(en.confirmTreeCopyLabel)).toBeTruthy();
  expect(inFold.getByText(en.confirmTreeTrashLabel)).toBeTruthy();
  expect(fold.querySelector("details")).toBeNull();
  // The Files group no longer holds them, and the fold ends the page.
  expect(
    group(en.settingsFilesGroup).queryByText(en.confirmTreeCopyLabel),
  ).toBeNull();
  expect(fold.nextElementSibling).toBeNull();
});

it("keeps the system's three rows together, the default editor first", () => {
  draw();
  const rows = [
    ...document
      .querySelector('[aria-label="System"]')!
      .querySelectorAll(".settings-row"),
  ].map((r) => r.textContent);
  expect(rows).toEqual(["Default editor", "Background", "Install CLI"]);
});

it("is searched: a moved draft switch is found on General, under Files", () => {
  draw();
  const entries = harvestPage(document.body, "general");
  expect(
    matchEntries(entries, "unsaved content").map((m) => [
      m.entry.page,
      m.entry.group,
    ]),
  ).toEqual([["general", en.settingsFilesGroup]]);
  const [hit] = matchEntries(entries, "unsaved content");
  expect(findEntryElement(document.body, hit.entry)).toBeTruthy();
});
