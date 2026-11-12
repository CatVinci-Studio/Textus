// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import { DEFAULT_SETTINGS } from "../../prefs/settings-types";
import { fs } from "../../platform/ipc";
import { saveAndInsertImages } from "./image-store";
import { FILE_CREATED_EVENT } from "../../utils/events";

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
    .mockResolvedValue({ src: "../p.png", embed: "![[p.png]]", path: null });
  const t = await openView("Text ");
  await saveAndInsertImages(t.view, [image], store);
  expect(t.markdown()).toContain("![[p.png]]");
  // Every picture type the paste takes is saved, .avif too.
  save.mockResolvedValue({ src: "assets/a.avif", embed: null, path: null });
  await saveAndInsertImages(t.view, [{ ...image, type: "image/avif" }], store);
  expect(save.mock.calls.at(-1)?.[2]).toBe("avif");
  save.mockResolvedValue({ src: "assets/q.png", embed: null, path: null });
  await saveAndInsertImages(t.view, [image], store);
  expect(t.markdown()).toContain("![](assets/q.png)");
});

it("tells of the picture file it saved in the document's folder", async () => {
  vi.spyOn(fs, "savePastedImage").mockResolvedValue({
    src: "assets/r.png",
    embed: null,
    path: "/vault/notes/assets/r.png",
  });
  const created: string[] = [];
  const hear = (e: Event) => created.push((e as CustomEvent<string>).detail);
  window.addEventListener(FILE_CREATED_EVENT, hear);
  const t = await openView("Text ");
  await saveAndInsertImages(t.view, [image], store);
  window.removeEventListener(FILE_CREATED_EVENT, hear);
  expect(created).toEqual(["/vault/notes/assets/r.png"]);
});
