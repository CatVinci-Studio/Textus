// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AvailablePlugins } from "./AvailablePlugins";
import { currentStrings } from "../../i18n/current";
import { parseManifest } from "../../plugins/store/manifest";
import type { CatalogItem } from "../../plugins/store/catalog";
import type { Strings } from "../../i18n/strings";

const item = (id: string, extra: object): CatalogItem => ({
  id,
  version: "1.0.0",
  official: true,
  size: 1,
  screenshots: [],
  hasReadme: false,
  manifest: parseManifest({
    id,
    name: id,
    version: "1.0.0",
    publisher: "catvinci",
    engines: { textus: ">=1.3.0" },
    ...extra,
  }),
});

const store = (t: Strings, query: string) =>
  render(
    <AvailablePlugins
      t={t}
      catalog={{
        status: "ready",
        skills: [],
        items: [
          item("a.zotero", { category: "sync", platforms: ["desktop"] }),
          item("a.tags", { category: "notes", platforms: ["desktop", "ios"] }),
          item("a.misc", { platforms: ["desktop", "ios"] }),
        ],
      }}
      query={query}
      installed={new Set()}
      actionFor={() => null}
      onOpen={() => {}}
    />,
  );
const listed = (container: HTMLElement) =>
  [...container.querySelectorAll(".plugin-subgroup-title, [data-catalog]")].map(
    (el) => el.getAttribute("data-catalog") ?? el.textContent,
  );

describe("the plugins Get more offers", () => {
  afterEach(cleanup);

  it("come by category, a computer-only one marked so", () => {
    const t = currentStrings();
    const { container } = store(t, "");
    expect(listed(container)).toEqual([
      t.pluginCategoryNotes,
      "a.tags",
      t.pluginCategorySync,
      "a.zotero",
      t.pluginCategoryOther,
      "a.misc",
    ]);
    const marked = [...container.querySelectorAll("[data-catalog]")].filter(
      (card) => card.textContent?.includes(t.pluginDesktopOnlyBadge),
    );
    expect(marked.map((c) => c.getAttribute("data-catalog"))).toEqual([
      "a.zotero",
    ]);
  });

  it("by name are one list, but a search keeps the categories", () => {
    const t = currentStrings();
    const byName = () => {
      fireEvent.click(
        screen.getByRole("combobox", { name: t.pluginsSortLabel }),
      );
      fireEvent.click(screen.getByRole("option", { name: t.pluginsSortName }));
    };
    const all = store(t, "");
    byName();
    expect(listed(all.container)).toEqual(["a.misc", "a.tags", "a.zotero"]);
    cleanup();
    const found = store(t, "a.");
    byName();
    expect(listed(found.container)).toEqual([
      t.pluginCategoryNotes,
      "a.tags",
      t.pluginCategorySync,
      "a.zotero",
      t.pluginCategoryOther,
      "a.misc",
    ]);
  });
});
