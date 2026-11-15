import { afterEach, describe, expect, it, vi } from "vitest";
import { makeBlankTab, type DocTab } from "./doc-tabs";
import { restoreTabsInOrder } from "./phone-restore";
import {
  resetWindowModelForTests,
  setWindowTabs,
  tabInUse,
  windowTabs,
} from "../engine/layout/store";

afterEach(() => resetWindowModelForTests());

const ai = (): DocTab => ({
  ...makeBlankTab(),
  view: { kind: "page", view: "ai" } as DocTab["view"],
});

function launch(o: { keys: string[]; active: string; last: string | null }) {
  const initial = makeBlankTab();
  const page = ai();
  const draft = { ...makeBlankTab(), content: "kept" };
  setWindowTabs<DocTab>(() => [initial, page, draft]);
  const tabsForPaths = vi.fn(async () => [] as DocTab[]);
  const run = restoreTabsInOrder({
    order: { keys: o.keys, active: o.active },
    restored: [draft],
    oldIds: new Map([[draft.id, "d1"]]),
    last: o.last,
    phone: true,
    initial: initial.id,
    loadRecovered: () => {},
    loadFile: async () => true,
    tabsForPaths,
    setTabs: (update) =>
      setWindowTabs<DocTab>((prev) => update(prev as DocTab[])),
  });
  return { run, page, tabsForPaths };
}

describe("a phone's tabs brought back in order", () => {
  it("leaves out the last document when the order had it closed", async () => {
    const { run, tabsForPaths } = launch({
      keys: ["id:d1", "view:ai"],
      active: "id:d1",
      last: "/n/closed.md",
    });
    await run;
    expect(tabsForPaths).toHaveBeenCalledWith([], true);
  });

  it("still brings it for an order of drafts alone (an older build's)", async () => {
    const { run, tabsForPaths } = launch({
      keys: ["id:d1"],
      active: "id:d1",
      last: "/n/last.md",
    });
    await run;
    expect(tabsForPaths).toHaveBeenCalledWith(["/n/last.md"], true);
  });

  it("puts the AI's page back in front when it was", async () => {
    const { run, page } = launch({
      keys: ["view:ai", "id:d1"],
      active: "view:ai",
      last: null,
    });
    await run;
    expect(tabInUse()).toBe(page.id);
    expect(windowTabs()[0]?.id).toBe(page.id);
  });
});
