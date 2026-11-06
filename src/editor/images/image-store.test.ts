// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { closeViews, openView } from "../../document-view/editor-view-kit";
import { DEFAULT_SETTINGS } from "../../prefs/settings-types";
import { fs } from "../../platform/ipc";
import { saveAndInsertImages } from "./image-store";

afterEach(closeViews);

const image = { name: "p.png", type: "image/png", base64: async () => "eA==" };
const store = {
  docPath: () => "/vault/notes/a.md",
  settings: () => DEFAULT_SETTINGS,
  requestName: async () => null,
  onError: () => "failed",
};

it("inserts a pasted picture as the vault's ![[…]] embed when it writes wiki links", async () => {
  const save = vi
    .spyOn(fs, "savePastedImage")
    .mockResolvedValue({ src: "../p.png", embed: "![[p.png]]" });
  const t = await openView("Text ");
  await saveAndInsertImages(t.view, [image], store);
  expect(t.markdown()).toContain("![[p.png]]");
  save.mockResolvedValue({ src: "assets/q.png", embed: null });
  await saveAndInsertImages(t.view, [image], store);
  expect(t.markdown()).toContain("![](assets/q.png)");
});
