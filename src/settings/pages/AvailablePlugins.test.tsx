// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AvailablePlugins } from "./AvailablePlugins";
import { currentStrings } from "../../i18n/current";
import { parseManifest } from "../../plugins/store/manifest";
import type { CatalogItem } from "../../plugins/store/catalog";

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

describe("the plugins Get more offers", () => {
  afterEach(cleanup);

  it("come by category, a computer-only one marked so", () => {
    const t = currentStrings();
    const { container } = render(
      <AvailablePlugins
        t={t}
        catalog={{
          status: "ready",
          skills: [],
          items: [
            item("a.zotero", { category: "sync", platforms: ["desktop"] }),
            item("a.tags", {
              category: "notes",
              platforms: ["desktop", "ios"],
            }),
            item("a.misc", { platforms: ["desktop", "ios"] }),
          ],
        }}
        query=""
        installed={new Set()}
        actionFor={() => null}
        onOpen={() => {}}
      />,
    );
    const order = [
      ...container.querySelectorAll(".plugin-subgroup-title, [data-catalog]"),
    ].map((el) => el.getAttribute("data-catalog") ?? el.textContent);
    expect(order).toEqual([
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
});
