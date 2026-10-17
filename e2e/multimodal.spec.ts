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
  await page
    .getByRole("button", { name: "Create with AI", exact: true })
    .click();
  const workspace = page.getByRole("region", { name: "Agent Workspace" });
  await workspace.getByRole("button", { name: "Dictate", exact: true }).click();
  await workspace
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Stop and transcribe", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1100); // Allow one MediaRecorder timeslice of synthetic audio.
  await workspace
    .getByRole("button", { name: "Stop and transcribe", exact: true })
    .click();
  const transcript = workspace.getByRole("textbox", {
    name: "Transcription",
    exact: true,
  });
  await expect(transcript).toHaveValue("Transcribed 中文 text.");
  await transcript.fill("Edited 中文 prompt.");
  await workspace
    .getByRole("button", { name: "Use in composer", exact: true })
    .click();
  await expect(workspace.locator(".inline-chat-input")).toHaveValue(
    "Edited 中文 prompt.",
  );
  await expect(workspace.locator(".workspace-document")).not.toContainText(
    "Edited 中文 prompt.",
  );
  await expect(workspace.locator(".workspace-tasks p")).toHaveCount(0);
});

test("editor dictation waits for explicit insertion", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, {
    media_provider_status: { stt: provider },
    media_transcribe: "A reviewed paragraph.",
  });
  await page.getByRole("button", { name: "Dictate", exact: true }).click();
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await page.waitForTimeout(1100);
  await page
    .getByRole("button", { name: "Stop and transcribe", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Transcription", exact: true }),
  ).toHaveValue("A reviewed paragraph.");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).not.toContainText("A reviewed paragraph.");
  await page
    .getByRole("button", { name: "Insert into document", exact: true })
    .click();
  await expect(editor).toContainText("A reviewed paragraph.");
});

test("image generation produces a local asset proposal and requires explicit insertion", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "## Section\n\nOriginal paragraph.");
  await mockInvoke(page, {
    media_provider_status: { image: { ...provider, model: "image-model" } },
  });
  await page.route("**/__dev-assets/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#ddd"/><text x="10" y="50">Test illustration</text></svg>',
    }),
  );
  await page.evaluate(() => {
    const runtime = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const original = runtime.invoke;
    let job: Record<string, unknown> | null = null;
    runtime.invoke = async (command, args) => {
      if (command === "media_image_jobs") return job ? [job] : [];
      if (command === "media_start_image") {
        const { permission, request } = args as {
          permission: Record<string, unknown>;
          request: unknown;
        };
        job = {
          jobId: "image-test",
          ...permission,
          sequence: 1,
          request,
          status: "ready",
          previewPath: "/tmp/test.png",
          model: "image-model",
          error: null,
          width: 160,
          height: 100,
          assetSrc: null,
        };
        return job;
      }
      if (command === "media_prepare_image") return "assets/generated-test.png";
      if (command === "media_finish_image") {
        if (job) {
          job.status = "committed";
          job.assetSrc = "assets/generated-test.png";
        }
        return null;
      }
      return original(command, args);
    };
  });
  const generator = page.locator(".workspace-launch .image-generator");
  await generator.locator("summary").click();
  await generator.getByLabel("Image prompt").fill("A system diagram");
  await generator
    .getByLabel("Insert after", { exact: false })
    .fill("## Section");
  await generator.getByLabel("Alternative text").fill("System diagram");
  await generator
    .getByRole("button", { name: "Generate image", exact: true })
    .click();
  const card = page.locator(".image-job");
  await expect(card).toContainText("System diagram");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor.locator('img[src*="generated-test.png"]')).toHaveCount(0);
  await card.getByRole("button", { name: "Insert image", exact: true }).click();
  await expect(editor.locator('img[src*="generated-test.png"]')).toHaveCount(1);
  await expect(editor).toContainText("Original paragraph.");
});

test("read aloud pauses, resumes and stops without changing the document", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "First paragraph.\n\nSecond paragraph.");
  await mockInvoke(page, {
    media_provider_status: {
      tts: { ...provider, model: "speech-model", voice: "alloy" },
    },
    media_synthesize: { dataBase64: "YXVkaW8=", mime: "audio/mpeg" },
  });
  // Mock playback only; the real hook still requests, queues and cleans up audio.
  await page.evaluate(() => {
    class TestAudio {
      src: string;
      playbackRate = 1;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
      }
      async play() {}
      pause() {}
      load() {}
      removeAttribute() {
        this.src = "";
      }
    }
    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: TestAudio,
    });
  });
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  const before = await editor.innerText();
  const player = page.locator(".workspace-launch .speech-player");
  await player.locator("summary").click();
  await player.getByRole("button", { name: "Play", exact: true }).click();
  await expect(editor.locator(".speech-reading")).not.toHaveCount(0);
  await player.getByRole("button", { name: "Pause", exact: true }).click();
  await player.getByRole("button", { name: "Resume", exact: true }).click();
  await player
    .getByRole("button", { name: "Stop reading", exact: true })
    .click();
  await expect(editor.locator(".speech-reading")).toHaveCount(0);
  expect(await editor.innerText()).toBe(before);
});
