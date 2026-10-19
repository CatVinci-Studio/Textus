import { expect, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * A document opened from a stand-in disk, for the image flows
 * (missing-image.spec.ts, image-menu.spec.ts): opened the way a dropped
 * file is, so relative srcs have a folder to resolve against, with the
 * backend's file questions answered from `Disk` and the commands that
 * would reach outside the page recorded instead (calls()).
 */

export const editor = '[data-active-tab="true"] .ProseMirror';
export const DOC_PATH = "/home/me/notes/trip.md";
export const PICKED = "/home/me/Pictures/new cat.png";

// A 1x1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export interface Disk {
  /** Paths the backend says exist (file_mtime_ms). */
  existing?: string[];
  /** Paths the asset protocol serves a picture for. */
  loadable?: string[];
  /** The vault's files, by the link that finds them (resolve_vault_image). */
  vault?: Record<string, string>;
  /** Web addresses that serve a picture; any other can't be reached. */
  web?: string[];
}

/** Opens `markdown` as DOC_PATH, with a stand-in disk, in `language`. */
export async function openDoc(
  page: Page,
  markdown: string,
  disk: Disk = {},
  language = "en",
) {
  const loadable = new Set(disk.loadable ?? []);
  const web = new Set(disk.web ?? []);
  await page.route("http://asset.localhost/**", (route) => {
    const path = decodeURIComponent(
      new URL(route.request().url()).pathname.slice(1),
    );
    return loadable.has(path)
      ? route.fulfill({
          contentType: "image/png",
          body: Buffer.from(PNG, "base64"),
        })
      : route.fulfill({ status: 404, body: "" });
  });
  // Nothing leaves the machine.
  await page.route("https://img.example.com/**", (route) =>
    web.has(route.request().url())
      ? route.fulfill({
          contentType: "image/png",
          body: Buffer.from(PNG, "base64"),
        })
      : route.abort(),
  );
  await openApp(page, { settings: { language } });
  await page.evaluate(
    ({ markdown, docPath, existing, vault, picked, png }) => {
      const w = window as unknown as Record<string, unknown> & {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
        };
      };
      const calls: { cmd: string; args: Record<string, unknown> }[] = [];
      w.__diskCalls = calls;
      const there = new Set([docPath, ...existing]);
      // The system clipboard is the machine's: what was copied is recorded.
      navigator.clipboard.writeText = (text) => {
        calls.push({ cmd: "clipboard", args: { text } });
        return Promise.resolve();
      };
      const original = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = (cmd, args = {}) => {
        switch (cmd) {
          case "read_text_file":
            return Promise.resolve(markdown);
          case "file_mtime_ms":
            return Promise.resolve(there.has(String(args.path)) ? 1 : null);
          case "resolve_vault_image":
            return Promise.resolve(vault[String(args.link)] ?? null);
          case "open_image_file_dialog":
          case "read_binary_file_base64":
          case "save_pasted_image":
          case "reveal_in_dir":
            calls.push({ cmd, args });
            return Promise.resolve(
              {
                open_image_file_dialog: picked,
                read_binary_file_base64: png,
                save_pasted_image: { src: "assets/image-1.png" },
                reveal_in_dir: null,
              }[cmd],
            );
        }
        return original(cmd, args);
      };
      (w.__devEmitTauriEvent as (name: string, payload: unknown) => void)(
        "tauri://drag-drop",
        {
          paths: [docPath],
          position: { x: 0, y: 0 },
        },
      );
    },
    {
      markdown,
      docPath: DOC_PATH,
      existing: disk.existing ?? [],
      vault: disk.vault ?? {},
      picked: PICKED,
      png: PNG,
    },
  );
  const doc = page.locator(editor);
  await expect(
    doc.locator(":is(.image-view, .obsidian-embed-rendered)").first(),
  ).toBeAttached();
  return doc;
}

export const calls = (page: Page, cmd: string) =>
  page.evaluate(
    (cmd) =>
      (
        (window as unknown as { __diskCalls: { cmd: string; args: object }[] })
          .__diskCalls ?? []
      ).filter((call) => call.cmd === cmd),
    cmd,
  );
