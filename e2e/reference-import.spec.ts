import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// The project menu's "Import references…": the picked files go into the
// project's references/ folder, and the panel says how many.

const workspace = {
  instructions: [],
  project_instructions: "",
  skills: [],
  root: "/Users/me/Paper",
  style: null,
  library: [],
  memories: { items: [], chars: 0, cap: 4000 },
  remember: false,
};

test("Import references… imports the picked files and says how many were left out", async ({
  page,
}) => {
  await page.addInitScript((ws) => {
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      {
        load_agent_workspace: ws,
        import_references_picked: { imported: 12, skipped: 2 },
      };
  }, workspace);
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await page.getByRole("tab", { name: "Project" }).click();
  await page.locator(".project-bar-folder").click();
  await page.getByRole("menuitem", { name: "Import references…" }).click();
  await expect(page.locator(".project-bar")).toContainText(
    "12 files added to references/ for Textus AI to search; 2 left out",
  );
  const calls = await page.evaluate(() =>
    (
      (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
        .__devInvokeCalls ?? []
    ).filter((c) => c.cmd === "import_references_picked"),
  );
  expect(calls).toEqual([expect.objectContaining({ folder: false })]);
});
