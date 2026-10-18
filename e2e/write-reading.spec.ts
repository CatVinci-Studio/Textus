import { expect, test } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

test("Write has compact reading controls; right-click sends only the selected text", async ({
  page,
}, testInfo) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    "Before paragraph.\n\nSelected words.\n\nAfter paragraph.",
  );
  await mockInvoke(page, {
    media_provider_status: {
      tts: {
        provider: "openai",
        endpoint: "https://api.openai.com/v1",
        model: "tts-1",
        voice: "alloy",
        playbackRate: 1.2,
      },
    },
  });
  await page.evaluate(() => {
    const state = window as unknown as {
      __readingRequests: string[];
      __TAURI_INTERNALS__: {
        invoke(command: string, args?: unknown): Promise<unknown>;
      };
    };
    state.__readingRequests = [];
    const original = state.__TAURI_INTERNALS__.invoke;
    state.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === "media_synthesize") {
        state.__readingRequests.push((args as { text: string }).text);
        return new Promise(() => {});
      }
      return original(command, args);
    };
  });
  const reader = page.locator(".write-playback");
  await expect(
    reader.getByRole("button", { name: "Read document aloud" }),
  ).toBeVisible();
  await expect(reader.locator("input, select, details, textarea")).toHaveCount(
    0,
  );
  await reader.getByRole("button", { name: "Read document aloud" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __readingRequests: string[] })
            .__readingRequests,
      ),
    )
    .toEqual(["Before paragraph."]);
  await reader.getByRole("button", { name: "Stop reading" }).click();
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  const selected = editor.locator("p").filter({ hasText: "Selected words." });
  await selected.evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await selected.click({ button: "right" });
  await page.getByText("Read selected text", { exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __readingRequests: string[] })
            .__readingRequests,
      ),
    )
    .toEqual(["Before paragraph.", "Selected words."]);
  await expect(editor).toContainText("Before paragraph.");
  await expect(editor).toContainText("After paragraph.");
  await reader.getByRole("button", { name: "Stop reading" }).click();
  await page.screenshot({
    path: testInfo.outputPath("write-reading-light.png"),
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: testInfo.outputPath("write-reading-dark.png"),
  });
  await page.setViewportSize({ width: 640, height: 780 });
  await page.screenshot({
    path: testInfo.outputPath("write-reading-narrow.png"),
  });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(reader).toHaveCount(0);
  await expect(page.locator(".speech-player, .image-generator")).toHaveCount(0);
  for (const engine of ["harness", "codex", "claude-code"]) {
    await page
      .getByRole("combobox", { name: "Agent engine" })
      .selectOption(engine);
    const images = page.getByRole("checkbox", {
      name: "Allow images for this request",
    });
    await expect(images).toBeEnabled();
    await expect(images).not.toBeChecked();
  }
});
