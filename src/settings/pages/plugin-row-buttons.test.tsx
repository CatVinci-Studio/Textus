// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AvailableButton } from "./plugin-row-buttons";
import { resolveStrings } from "../../i18n/strings";
import type { CatalogItem } from "../../plugins/store/catalog";

afterEach(cleanup);
const t = resolveStrings("en");
const item = (engine: string) =>
  ({
    id: "a.future",
    version: "1.0.0",
    official: true,
    manifest: { id: "a.future", name: "Future", engine },
    size: 1,
    screenshots: [],
    hasReadme: false,
  }) as unknown as CatalogItem;

it("says which Textus a plugin needs instead of showing no button", () => {
  const onInstall = vi.fn();
  render(
    <AvailableButton
      t={t}
      item={item(">=99.0.0")}
      installing={null}
      onInstall={onInstall}
    />,
  );
  const button = screen.getByRole("button");
  expect(button.getAttribute("aria-label")).toContain("99.0.0");
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(button);
  expect(onInstall).not.toHaveBeenCalled();
});

it("offers Install for a plugin that runs here", () => {
  const onInstall = vi.fn();
  render(
    <AvailableButton
      t={t}
      item={item(">=1.0.0")}
      installing={null}
      onInstall={onInstall}
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(onInstall).toHaveBeenCalledOnce();
});
