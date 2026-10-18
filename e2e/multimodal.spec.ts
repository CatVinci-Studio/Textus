import { expect, test } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
const provider = {
  provider: "openai-compatible",
  endpoint: "http://localhost:1234/v1",
  model: "transcriber",
  voice: null,
};
// Synthetic Web Audio input exercises the browser's real MediaRecorder
// without depending on the host OS microphone permission dialog/device.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        await context.resume();
        for (const track of destination.stream.getTracks()) {
          const original = track.stop.bind(track);
          track.stop = () => {
            original();
            oscillator.stop();
            void context.close();
          };
        }
        return destination.stream;
      },
    });
  });
});
test("dictation is editable and enters the composer without sending a model request", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, {
    media_provider_status: {
      stt: {
        provider: "minimax",
        endpoint: "https://api.minimax.cn/v1",
        model: "asr-1.0",
        voice: null,
      },
    },
    media_transcribe: "Transcribed 中文 text.",
  });
  await page.evaluate(() => {
    const runtime = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const original = runtime.invoke;
    runtime.invoke = async (command, args) => {
      if (command === "media_transcribe") {
        const { mime, dataBase64 } = args as {
          mime: string;
          dataBase64: string;
        };
        if (mime !== "audio/wav" || !atob(dataBase64).startsWith("RIFF"))
          throw new Error("MiniMax must receive locally converted WAV");
      }
      return original(command, args);
    };
  });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const workspace = page.getByRole("region", { name: "Agent Workspace" });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("textus-media-settings-change")),
  );
  await page.waitForTimeout(50);
  await workspace
    .getByRole("button", { name: "Voice input", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Stop dictation", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1100);
  await workspace
    .getByRole("button", { name: "Stop dictation", exact: true })
    .click();
  await expect(workspace.locator(".inline-chat-input")).toHaveValue(
    "Transcribed 中文 text.",
  );
  await workspace.locator(".inline-chat-input").fill("Edited 中文 prompt.");
  await expect(workspace.locator(".inline-chat-input")).toHaveValue(
    "Edited 中文 prompt.",
  );
  await expect(workspace.locator(".workspace-document")).not.toContainText(
    "Edited 中文 prompt.",
  );
  await expect(workspace.locator(".workspace-tasks p")).toHaveCount(0);
});

test("Write keeps only the document and navigation, without media forms or launch controls", async ({
  page,
}, testInfo) => {
  await openApp(page, { settings: { language: "en" } });
  await page.screenshot({ path: testInfo.outputPath("write-clean.png") });
  await expect(page.locator(".workspace-launch")).toHaveCount(0);
  await expect(page.getByText("Read aloud", { exact: true })).not.toBeVisible();
  await expect(
    page.getByText("Generate illustration", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dictate", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create with AI", exact: true }),
  ).not.toBeVisible();
});

test("right-click selection refines the image prompt with the selected engine and inserts below the passage", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-engine": "codex" },
  });
  await pasteMarkdown(
    page,
    "A forest beside a blue lake.\n\nFollowing paragraph.",
  );
  await mockInvoke(page, {
    media_provider_status: { image: { ...provider, model: "image-model" } },
  });
  await page.evaluate(() => {
    const runtime = (window as any).__TAURI_INTERNALS__;
    const original = runtime.invoke;
    let job: any = null;
    runtime.invoke = async (command: string, args: any) => {
      if (command === "ai_agent_message") {
        if (
          args.engine !== "codex" ||
          args.document !== "A forest beside a blue lake." ||
          !args.message.includes("A forest beside a blue lake.")
        )
          throw new Error("Wrong refinement engine or selection");
        return [
          {
            kind: "Assistant",
            text: "A cinematic forest framing a blue alpine lake, soft morning light, balanced composition.",
          },
        ];
      }
      if (command === "media_start_image") {
        if (!args.request.prompt.startsWith("A cinematic forest"))
          throw new Error("Unrefined prompt");
        job = {
          jobId: "selection-image",
          ...args.permission,
          sequence: 1,
          request: args.request,
          status: "ready",
          previewPath: "/tmp/selection.png",
          model: "image-01",
          error: null,
          width: 1024,
          height: 1024,
          assetSrc: null,
        };
        return job;
      }
      if (command === "media_image_jobs") return job ? [job] : [];
      if (command === "media_prepare_image") return "assets/selection.png";
      if (command === "media_finish_image") {
        job.status = "committed";
        job.assetSrc = "assets/selection.png";
        return null;
      }
      return original(command, args);
    };
  });
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  await editor
    .locator("p")
    .first()
    .evaluate((el) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
  await page.waitForTimeout(100);
  await editor
    .locator("p")
    .first()
    .click({ button: "right", position: { x: 50, y: 10 } });
  await page
    .getByText("Generate image below selection", { exact: true })
    .click();
  await expect(editor.locator('img[src*="selection.png"]')).toHaveCount(1);
  const blocks = await editor
    .locator(":scope > *")
    .evaluateAll((els) =>
      els.map(
        (el) =>
          el.textContent || el.querySelector("img")?.getAttribute("src") || "",
      ),
    );
  expect(blocks[0]).toContain("A forest beside a blue lake.");
  expect(blocks[1]).toContain("selection.png");
  expect(blocks[2]).toContain("Following paragraph.");
});
