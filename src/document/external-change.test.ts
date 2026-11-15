// @vitest-environment jsdom
import { expect, it } from "vitest";
import { takeDiskText } from "./useExternalChangeReload";
import { makeBlankTab, type DocTab } from "./doc-tabs";
import { onPluginEvent } from "../plugins/app-bridge";

it("tells plugins what an open file held and holds after a change elsewhere", () => {
  const tab: DocTab = {
    ...makeBlankTab(),
    path: "/work/rain.md",
    content: "# Rain\n",
    savedContent: "# Rain\n",
  };
  const heard: unknown[] = [];
  const stop = onPluginEvent("fileChangeOnDisk", (e) => heard.push(e));
  const patches: Partial<DocTab>[] = [];
  takeDiskText(
    tab,
    "# Flood\n",
    99,
    () => [tab],
    (_id, patch) => patches.push(patch),
  );
  stop();
  expect(heard).toEqual([
    { path: "/work/rain.md", before: "# Rain\n", after: "# Flood\n" },
  ]);
  expect(patches[0]).toMatchObject({ content: "# Flood\n", diskMtime: 99 });
});
