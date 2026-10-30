import { expect, test, type Page } from "@playwright/test";
import { hasPlugin, openPath, openWithPlugins } from "./plugin-helpers";

// The Reminders plugin: `(@date time)` marks in the folder's documents kept
// as Textus jobs that notify, and dropped when the line goes or is ticked.

const ID = "catvinci.reminders";
test.skip(!hasPlugin(ID), `${ID} is not in this checkout`);

type Shim = {
  __devSchedule: {
    jobs: Map<string, Map<string, { at?: string; notify?: { title: string } }>>;
    notifications: { title: string }[];
    fire(plugin: string, id: string): void;
  };
};

/** The plugin's jobs: `when → title`. */
const jobs = (page: Page) =>
  page.evaluate((id) => {
    const mine = (window as unknown as Shim).__devSchedule.jobs.get(id);
    return Object.fromEntries(
      [...(mine?.values() ?? [])].map((j) => [j.at, j.notify?.title]),
    );
  }, ID);

test("the folder's marks become reminders, and a ticked one is let go", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { [ID]: ["files.read", "editor.write", "notifications"] },
    folder: {
      "/notes/plan.md":
        "# Plan\n\n- [ ] Send the draft (@2099-11-02 14:30)\n- [x] Old one (@2099-11-02 10:00)\n",
      "/notes/calls.md": "Call Mum (@2099-11-03)\n",
    },
  });
  await openPath(page, "/notes/plan.md");
  await expect
    .poll(() => jobs(page))
    .toEqual({
      "2099-11-02T14:30": "Send the draft",
      "2099-11-03T09:00": "Call Mum",
    });

  // Ticked and saved: no longer a reminder.
  // As a click on its box does: the item's `checked`.
  await page.evaluate(() => {
    type Node = {
      type: { name: string };
      attrs: Record<string, unknown>;
      textContent: string;
    };
    const view = (
      window as unknown as {
        __pmView: {
          state: {
            doc: { descendants(f: (n: Node, pos: number) => void): void };
            tr: {
              setNodeMarkup(
                pos: number,
                type: undefined,
                attrs: object,
              ): unknown;
            };
          };
          dispatch(tr: unknown): void;
          focus(): void;
        };
      }
    ).__pmView;
    let at = -1;
    let attrs = {};
    view.state.doc.descendants((n, pos) => {
      if (
        at < 0 &&
        n.type.name === "list_item" &&
        n.textContent.startsWith("Send")
      ) {
        at = pos;
        attrs = n.attrs;
      }
    });
    view.dispatch(
      view.state.tr.setNodeMarkup(at, undefined, { ...attrs, checked: true }),
    );
    view.focus();
  });
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __devFs: Record<string, string> }).__devFs[
            "/notes/plan.md"
          ],
      ),
    )
    .toContain("[x] Send");
  await expect
    .poll(() => jobs(page))
    .toEqual({ "2099-11-03T09:00": "Call Mum" });
});
