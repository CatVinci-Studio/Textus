import { expect, it } from "vitest";
import { folderReopener } from "./folder-reopen";

it("a folder opened next stops the last one's documents coming back", async () => {
  const opened: string[] = [];
  let letGo = () => {};
  const reopen = folderReopener(
    async (folder) => [`${folder}/1.md`, `${folder}/2.md`],
    async (path) => {
      opened.push(path);
      if (path === "/b/1.md") await new Promise<void>((go) => (letGo = go));
    },
  );
  const b = reopen("/b");
  await Promise.resolve();
  await Promise.resolve();
  const c = reopen("/c");
  letGo();
  await Promise.all([b, c]);
  expect(opened).toEqual(["/b/1.md", "/c/1.md", "/c/2.md"]);
});
