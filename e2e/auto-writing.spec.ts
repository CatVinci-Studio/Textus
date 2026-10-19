import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Auto-writing end to end, against an agent that answers the way the real
 * one does: the plan as one reply; each section as a propose_edit streamed
 * over the onEvent channel (toolStart, argument fragments, the finished
 * turn), then a check and a report while the request is still running.
 * `hold()` keeps a request open after its proposal has arrived - the window
 * in which the user can already accept it.
 */

const SECTIONS = ["Origins", "Journey", "Return"];

async function fakeAgent(page: Page, sections = SECTIONS, image = false) {
  await page.evaluate(
    ({ sections, image }) => {
      type Send = (event: unknown) => void;
      const w = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown) => Promise<unknown>;
        };
        __fake: {
          hold: boolean;
          empty: boolean;
          jobs: Record<string, unknown>[];
          finishImages: () => void;
          release: (() => void) | null;
          requests: { title: string; imageTask: boolean; revision: boolean }[];
        };
      };
      const jobs: Record<string, unknown>[] = [];
      w.__fake = {
        hold: false,
        empty: false,
        jobs,
        // The picture service finishes everything still painting.
        finishImages: () => {
          for (const job of jobs)
            if (job.status === "running") {
              job.status = "ready";
              job.previewPath = `/tmp/${job.jobId}.png`;
              job.model = "image-01";
              job.width = 2;
              job.height = 1;
            }
        },
        release: null,
        requests: [],
      };
      const internals = w.__TAURI_INTERNALS__;
      const original = internals.invoke;
      let call = 0;
      internals.invoke = (cmd, args) => {
        // Fresh copies, as over IPC: the app compares one poll with the last.
        if (cmd === "media_image_jobs")
          return Promise.resolve(JSON.parse(JSON.stringify(jobs)));
        if (cmd === "media_prepare_image") {
          const job = jobs.find(
            (j) => j.jobId === (args as { jobId: string }).jobId,
          )!;
          job.status = "prepared";
          // An untitled document's pictures live by full path (fs.rs).
          return Promise.resolve(`/tmp/assets/${job.jobId}.png`);
        }
        if (cmd === "media_finish_image") {
          const a = args as { jobId: string; accepted: boolean };
          const job = jobs.find((j) => j.jobId === a.jobId)!;
          job.status = a.accepted ? "committed" : "ready";
          job.assetSrc = a.accepted ? `/tmp/assets/${job.jobId}.png` : null;
          return Promise.resolve(null);
        }
        if (
          cmd === "media_cancel_image" ||
          cmd === "media_cancel_image_generation"
        )
          return Promise.resolve(null);
        if (cmd === "project_folder") return Promise.resolve(null);
        if (cmd === "list_project_entries") return Promise.resolve([]);
        if (cmd !== "ai_agent_message") return original(cmd, args);
        const a = args as {
          message: string;
          imageTask?: unknown;
          onEvent?: { onmessage?: Send };
        };
        const send: Send = (event) => a.onEvent?.onmessage?.(event);
        if (a.message.startsWith("You plan a writing project"))
          return Promise.resolve([
            {
              kind: "Assistant",
              text: JSON.stringify({
                title: "Journey West",
                guide: "Plain words",
                sections: sections.map((title, i) => ({
                  title,
                  brief: `About ${title}`,
                  length: 120,
                  image: image && i === 1,
                })),
              }),
            },
          ]);
        const title =
          /Write section \d+, "([^"]+)"/.exec(a.message)?.[1] ?? "?";
        const revision = a.message.includes("notes on the previous draft");
        const first = a.message.includes("level-one heading");
        w.__fake.requests.push({ title, imageTask: !!a.imageTask, revision });
        // A reply with no proposal in it (what a failed turn looks like).
        if (w.__fake.empty)
          return Promise.resolve([
            { kind: "User", text: a.message },
            { kind: "Assistant", text: "Sorry, nothing this time." },
          ]);
        const tag = revision ? " (rewritten)" : "";
        const text = [
          first ? "# Journey West" : null,
          `## ${title}`,
          `First paragraph of ${title}${tag}.`,
          `Second paragraph of ${title}${tag}.`,
        ]
          .filter(Boolean)
          .join("\n\n");
        const id = `w${++call}`;
        const args2 = JSON.stringify({ action: "append", text });
        const proposal = {
          kind: "ToolCall",
          call_id: id,
          name: "propose_edit",
          arguments: args2,
        };
        const result = {
          kind: "ToolResult",
          call_id: id,
          output: "Edit proposed",
        };
        const check = {
          kind: "ToolCall",
          call_id: `c${call}`,
          name: "check_conventions",
          arguments: "{}",
        };
        const checked = {
          kind: "ToolResult",
          call_id: `c${call}`,
          output: "ok",
        };
        const report = { kind: "Assistant", text: `${title} is written.` };
        // A picture for this section, still painting when the reply ends.
        const permission = a.imageTask as
          | {
              taskId: string;
              documentId: string;
              generationId: string;
              baseRevision: number;
            }
          | undefined;
        const pictureTurns: unknown[] = [];
        if (permission) {
          const jobId = `pic-${call}`;
          jobs.push({
            jobId,
            ...permission,
            sequence: 1,
            request: {
              prompt: `A picture of ${title}`,
              anchor: `First paragraph of ${title}${tag}.`,
              alt: title,
              caption: `${title} at dusk`,
              size: "1024x1024",
            },
            status: "running",
            previewPath: null,
            model: null,
            error: null,
            width: null,
            height: null,
            assetSrc: null,
          });
          pictureTurns.push(
            {
              kind: "ToolCall",
              call_id: `g${call}`,
              name: "generate_image",
              arguments: JSON.stringify({ prompt: `A picture of ${title}` }),
            },
            {
              kind: "ToolResult",
              call_id: `g${call}`,
              output: JSON.stringify({ jobId, status: "running" }),
            },
          );
        }
        const third = Math.floor(args2.length / 3);
        const steps: (() => void | Promise<void>)[] = [
          () => send({ type: "toolStart", callId: id, name: "propose_edit" }),
          () =>
            send({
              type: "toolArgsDelta",
              callId: id,
              delta: args2.slice(0, third),
            }),
          () =>
            send({
              type: "toolArgsDelta",
              callId: id,
              delta: args2.slice(third, 2 * third),
            }),
          () =>
            send({
              type: "toolArgsDelta",
              callId: id,
              delta: args2.slice(2 * third),
            }),
          () => send({ type: "turn", turn: proposal }),
          () => send({ type: "turn", turn: result }),
          // Still talking: the proposal is in, the request is not over.
          () =>
            w.__fake.hold
              ? new Promise<void>((resolve) => {
                  w.__fake.release = resolve;
                })
              : undefined,
          ...pictureTurns.map((turn) => () => send({ type: "turn", turn })),
          () => send({ type: "turn", turn: check }),
          () => send({ type: "turn", turn: checked }),
          () => send({ type: "turn", turn: report }),
        ];
        return new Promise((resolve) => {
          const next = async () => {
            const step = steps.shift();
            if (!step) {
              resolve([
                { kind: "User", text: a.message },
                proposal,
                result,
                ...pictureTurns,
                check,
                checked,
                report,
              ]);
              return;
            }
            await step();
            setTimeout(next, 10);
          };
          void next();
        });
      };
    },
    { sections, image },
  );
}

/** Waits until a held request has its proposal in and is still open. */
async function whenHeld(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!(window as unknown as { __fake: { release: unknown } }).__fake
            .release,
      ),
    )
    .toBe(true);
}

async function release(page: Page) {
  await page.evaluate(() => {
    const fake = (
      window as unknown as { __fake: { release: (() => void) | null } }
    ).__fake;
    const go = fake.release;
    fake.release = null;
    go?.();
  });
}

/** Opens Agent, switches on "Write in sections" (and pictures) and sends
 *  the brief. */
async function startWriting(page: Page, options: { images?: boolean } = {}) {
  const workspace = page.getByRole("region", { name: "Agent Workspace" });
  const plus = workspace.getByRole("button", { name: "Add content and tools" });
  await plus.click();
  await workspace
    .getByRole("menuitemcheckbox", { name: /Write in sections/ })
    .click();
  if (options.images) {
    await plus.click();
    await workspace
      .getByRole("menuitemcheckbox", { name: /Allow images/ })
      .click();
  }
  await workspace.locator(".inline-chat-input").fill("A story for students");
  await workspace.getByRole("button", { name: "Send", exact: true }).click();
  const writer = workspace.getByRole("region", { name: "Auto-writing" });
  await expect(writer.locator(".auto-writer-outline li")).toHaveCount(
    SECTIONS.length,
  );
  return { workspace, writer };
}

const doc = (page: Page) =>
  page.locator('[data-active-tab="true"] .ProseMirror');

/** The document's text as the editor holds it, for order and count checks. */
async function docText(page: Page) {
  return (await doc(page).innerText()).replace(/\s+/g, " ");
}

async function expectOnce(page: Page, phrases: string[]) {
  const text = await docText(page);
  for (const phrase of phrases)
    expect(text.split(phrase).length - 1, `"${phrase}" once`).toBe(1);
  // In the order given.
  const at = phrases.map((p) => text.indexOf(p));
  expect([...at].sort((x, y) => x - y)).toEqual(at);
}

// A 2x1 PNG for every picture the app asks to show.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnxEIGAEAJ+YD/2jvfVUAAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.route("**/__dev-assets/**", (route) =>
    route.fulfill({ body: PNG, contentType: "image/png" }),
  );
  await openApp(page, { home: true, settings: { language: "en" } });
  await fakeAgent(page);
});

async function finishImages(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { __fake: { finishImages: () => void } }
    ).__fake.finishImages(),
  );
}

test("each section is reviewed: Accept and continue, to the end", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 820 });
  const { workspace, writer } = await startWriting(page);
  await writer.getByRole("button", { name: "Start writing" }).click();
  // The draft panel opens beside the card, never over its buttons.
  const button = writer.getByRole("button", { name: "Accept and continue" });
  await expect(button).toBeVisible();
  const panel = await workspace.locator(".workspace-preview").boundingBox();
  const box = await button.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(panel!.x);
  for (let i = 0; i < SECTIONS.length; i++) {
    await expect(writer.getByText(/Accept it in the draft/)).toBeVisible();
    await writer.getByRole("button", { name: "Accept and continue" }).click();
  }
  await expect(writer.getByText("Finished")).toBeVisible();
  await expect(writer.locator(".auto-writer-outline li.is-done")).toHaveCount(
    3,
  );
  // The chat: one folded row per section, each accepted.
  await expect(workspace.locator(".agent-section-row")).toHaveCount(3);
  await expect(workspace.locator(".agent-section-row.is-done")).toHaveCount(3);
  await expectOnce(page, [
    "Journey West",
    "First paragraph of Origins.",
    "Second paragraph of Origins.",
    "First paragraph of Journey.",
    "First paragraph of Return.",
    "Second paragraph of Return.",
  ]);
});

test("accepting a section in the draft moves on by itself", async ({
  page,
}) => {
  const { workspace, writer } = await startWriting(page);
  await writer.getByRole("button", { name: "Start writing" }).click();
  for (let i = 0; i < SECTIONS.length; i++) {
    await expect(writer.locator("li.is-review")).toHaveCount(1);
    await workspace
      .getByRole("button", { name: "Accept all", exact: true })
      .click();
  }
  await expect(writer.getByText("Finished")).toBeVisible();
  await expectOnce(page, [
    "First paragraph of Origins.",
    "First paragraph of Journey.",
    "First paragraph of Return.",
  ]);
});

test("a section accepted while the Agent is still finishing counts, once", async ({
  page,
}) => {
  const { workspace, writer } = await startWriting(page);
  await page.evaluate(() => {
    (window as unknown as { __fake: { hold: boolean } }).__fake.hold = true;
  });
  await writer.getByRole("button", { name: "Start writing" }).click();
  for (let i = 0; i < SECTIONS.length; i++) {
    // The proposal is in; the request is still running.
    await whenHeld(page);
    const acceptAll = workspace.getByRole("button", {
      name: "Accept all",
      exact: true,
    });
    await expect(acceptAll).toBeEnabled();
    await acceptAll.click();
    await release(page);
    if (i < SECTIONS.length - 1)
      await expect(writer.locator("li.is-done")).toHaveCount(i + 1);
  }
  await expect(writer.getByText("Finished")).toBeVisible();
  // No "nothing to review" error, and nothing written twice.
  await expect(writer.getByRole("alert")).toHaveCount(0);
  await expectOnce(page, [
    "First paragraph of Origins.",
    "Second paragraph of Origins.",
    "First paragraph of Journey.",
    "First paragraph of Return.",
  ]);
  await expect(workspace.locator(".workspace-review-actions")).toHaveCount(0);
});

test("one paragraph taken, one not: the section moves on with just the one", async ({
  page,
}) => {
  const { workspace, writer } = await startWriting(page);
  await writer.getByRole("button", { name: "Start writing" }).click();
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  const preview = workspace.locator(".workspace-document");
  const second = preview.locator("p", {
    hasText: "Second paragraph of Origins.",
  });
  await second.hover();
  await second.getByRole("button", { name: "Reject this paragraph" }).click();
  // Rejected: still shown, struck through, with Restore.
  await expect(preview.locator(".draft-part-rejected")).toHaveCount(1);
  for (const text of [
    "Journey West",
    "Origins",
    "First paragraph of Origins.",
  ]) {
    const block = preview
      .locator(".draft-part", { hasText: text })
      .filter({ hasNotText: "Second" })
      .first();
    await block.hover();
    await block
      .getByRole("button", { name: "Accept this paragraph", exact: true })
      .click();
  }
  // Every paragraph decided, one taken: on to the next section.
  await expect(writer.locator("li.is-done")).toHaveCount(1);
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  const text = await docText(page);
  expect(text).toContain("First paragraph of Origins.");
  expect(text).not.toContain("Second paragraph of Origins.");
  await expectOnce(page, ["Journey West", "First paragraph of Origins."]);
});

test("rejected in the draft it stays; skipped, the next one comes", async ({
  page,
}) => {
  const { workspace, writer } = await startWriting(page);
  await writer.getByRole("button", { name: "Start writing" }).click();
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  await workspace
    .getByRole("button", { name: "Reject all", exact: true })
    .click();
  // Nothing taken: no moving on by itself.
  await page.waitForTimeout(300);
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  await writer.getByRole("button", { name: "Skip" }).click();
  await expect(writer.locator("li.is-skipped")).toHaveCount(1);
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  await expect(writer.getByText("Finished")).toBeVisible();
  const text = await docText(page);
  expect(text).not.toContain("paragraph of Origins");
  await expectOnce(page, [
    "First paragraph of Journey.",
    "First paragraph of Return.",
  ]);
});

test("a section rewritten from notes replaces the first draft", async ({
  page,
}) => {
  const { writer } = await startWriting(page);
  await writer.getByRole("button", { name: "Start writing" }).click();
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  await writer.getByPlaceholder(/Notes, e\.g\./).fill("More vivid");
  await writer.getByRole("button", { name: "Rewrite this section" }).click();
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __fake: { requests: { revision: boolean }[] };
            }
          ).__fake.requests.filter((r) => r.revision).length,
      ),
    )
    .toBe(1);
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  await expect(writer.locator("li.is-done")).toHaveCount(1);
  const text = await docText(page);
  expect(text).toContain("First paragraph of Origins (rewritten).");
  expect(text).not.toContain("First paragraph of Origins.");
});

test("without review it writes every section in one go", async ({ page }) => {
  const { workspace, writer } = await startWriting(page);
  await writer.getByLabel("Pause for review after each section").uncheck();
  await writer.getByRole("button", { name: "Start writing" }).click();
  await expect(writer.getByText("Finished")).toBeVisible();
  await expect(writer.locator("li.is-done")).toHaveCount(3);
  await expect(workspace.locator(".workspace-review-actions")).toHaveCount(0);
  await expectOnce(page, [
    "Journey West",
    "First paragraph of Origins.",
    "Second paragraph of Journey.",
    "Second paragraph of Return.",
  ]);
});

test("pause stops after the section in hand; continue finishes", async ({
  page,
}) => {
  const { writer } = await startWriting(page);
  await page.evaluate(() => {
    (window as unknown as { __fake: { hold: boolean } }).__fake.hold = true;
  });
  await writer.getByLabel("Pause for review after each section").uncheck();
  await writer.getByRole("button", { name: "Start writing" }).click();
  await writer.getByRole("button", { name: "Pause" }).click();
  await whenHeld(page);
  await page.evaluate(() => {
    (window as unknown as { __fake: { hold: boolean } }).__fake.hold = false;
  });
  await release(page);
  await expect(writer.getByRole("button", { name: "Continue" })).toBeVisible();
  await expect(writer.locator("li.is-done")).toHaveCount(1);
  await writer.getByRole("button", { name: "Continue" }).click();
  await expect(writer.getByText("Finished")).toBeVisible();
  await expectOnce(page, [
    "First paragraph of Origins.",
    "First paragraph of Journey.",
    "First paragraph of Return.",
  ]);
});

test("stop ends it where it is", async ({ page }) => {
  const { writer } = await startWriting(page);
  await writer.getByRole("button", { name: "Start writing" }).click();
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  await writer.getByRole("button", { name: "Stop" }).click();
  await expect(writer.getByText("Finished")).toBeVisible();
  const requests = await page.evaluate(
    () =>
      (window as unknown as { __fake: { requests: unknown[] } }).__fake.requests
        .length,
  );
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __fake: { requests: unknown[] } }).__fake
          .requests.length,
    ),
  ).toBe(requests);
  expect(await docText(page)).not.toContain("Return");
});

test("a section marked for a picture asks for one; the others don't", async ({
  page,
}) => {
  await fakeAgent(page, SECTIONS, true);
  const { writer } = await startWriting(page, { images: true });
  // The outline says which section gets one.
  await expect(writer.locator(".auto-writer-picture")).toHaveCount(3);
  await writer.getByLabel("Pause for review after each section").uncheck();
  await writer.getByRole("button", { name: "Start writing" }).click();
  await expect(writer.getByText("Finished")).toBeVisible();
  const requests = await page.evaluate(
    () =>
      (
        window as unknown as {
          __fake: { requests: { title: string; imageTask: boolean }[] };
        }
      ).__fake.requests,
  );
  expect(requests.map((r) => [r.title, r.imageTask])).toEqual([
    ["Origins", false],
    ["Journey", true],
    ["Return", false],
  ]);
});

test("a section that brings nothing back says so, and can be retried", async ({
  page,
}, testInfo) => {
  const { writer } = await startWriting(page);
  await page.evaluate(() => {
    (window as unknown as { __fake: { empty: boolean } }).__fake.empty = true;
  });
  await writer.getByRole("button", { name: "Start writing" }).click();
  await expect(writer.getByRole("alert")).toContainText(
    "produced nothing to review",
  );
  await page.screenshot({ path: testInfo.outputPath("empty-section.png") });
  await page.evaluate(() => {
    (window as unknown as { __fake: { empty: boolean } }).__fake.empty = false;
  });
  await writer.getByRole("button", { name: "Retry" }).click();
  await expect(writer.getByRole("alert")).toHaveCount(0);
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  await expect(writer.locator("li.is-done")).toHaveCount(1);
  await expectOnce(page, ["First paragraph of Origins."]);
});

test("a picture still painting never holds the text back; it lands under its paragraph when done", async ({
  page,
}) => {
  await fakeAgent(page, SECTIONS, true);
  const { workspace, writer } = await startWriting(page, { images: true });
  await writer.getByRole("button", { name: "Start writing" }).click();
  // Origins: no picture.
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  // Journey: its picture is still painting, and its text can be taken now.
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  await expect(workspace.locator(".draft-image-pending")).toHaveCount(1);
  const acceptAll = workspace.getByRole("button", {
    name: "Accept all",
    exact: true,
  });
  await expect(acceptAll).toBeEnabled();
  await acceptAll.click();
  // On to Return straight away - not waiting for the picture.
  await expect(writer.locator("li.is-done")).toHaveCount(2);
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  // The picture finishes: it goes in under Journey's first paragraph, once.
  await finishImages(page);
  const picture = doc(page).getByRole("img", { name: "Journey" });
  await expect(picture).toHaveCount(1);
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  await expect(writer.getByText("Finished")).toBeVisible();
  const order = await doc(page)
    .locator(":scope > *")
    .evaluateAll((els) =>
      els.map((el) =>
        el.querySelector("img") ? "[picture]" : (el.textContent ?? "").trim(),
      ),
    );
  const at = order.indexOf("First paragraph of Journey.");
  expect(at).toBeGreaterThan(-1);
  expect(order.slice(at + 1).find((x) => x !== "")).toBe("[picture]");
  expect(order.filter((x) => x === "[picture]")).toHaveLength(1);
  await expectOnce(page, [
    "First paragraph of Origins.",
    "First paragraph of Journey.",
    "First paragraph of Return.",
  ]);
});

test("in one go, a picture finishing later still lands in its place", async ({
  page,
}) => {
  await fakeAgent(page, SECTIONS, true);
  const { writer } = await startWriting(page, { images: true });
  await writer.getByLabel("Pause for review after each section").uncheck();
  await writer.getByRole("button", { name: "Start writing" }).click();
  await expect(writer.getByText("Finished")).toBeVisible();
  await finishImages(page);
  await expect(doc(page).getByRole("img", { name: "Journey" })).toHaveCount(1);
  await expectOnce(page, [
    "First paragraph of Origins.",
    "First paragraph of Journey.",
    "First paragraph of Return.",
  ]);
});

test("a finished picture can be taken on its own before its text", async ({
  page,
}) => {
  await fakeAgent(page, SECTIONS, true);
  const { workspace, writer } = await startWriting(page, { images: true });
  await writer.getByRole("button", { name: "Start writing" }).click();
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  await finishImages(page);
  const figure = workspace.locator(".draft-image-ready");
  await expect(figure).toHaveCount(1);
  // Taking the picture takes no text with it.
  await figure.getByRole("button", { name: "Accept" }).click();
  await expect(figure).toContainText("Accepted");
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  expect(await docText(page)).not.toContain("First paragraph of Journey.");
  // The text, then: both go in.
  await workspace
    .getByRole("button", { name: "Accept all", exact: true })
    .click();
  await expect(doc(page).getByRole("img", { name: "Journey" })).toHaveCount(1);
  await expectOnce(page, ["First paragraph of Journey."]);
});

test("a picture still painting can be decided already: skipped, then taken back", async ({
  page,
}) => {
  await fakeAgent(page, SECTIONS, true);
  const { workspace, writer } = await startWriting(page, { images: true });
  await writer.getByRole("button", { name: "Start writing" }).click();
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  const painting = workspace.locator(".draft-image-pending");
  await expect(painting).toHaveCount(1);
  // Skip it before it is done: set aside, not cancelled.
  await painting.getByRole("button", { name: "Skip" }).click();
  await expect(workspace.locator(".draft-image-skipped")).toHaveCount(1);
  await workspace
    .getByRole("button", { name: "Accept all", exact: true })
    .click();
  await finishImages(page);
  await page.waitForTimeout(1200);
  // Done painting, but skipped: it never goes in by itself.
  await expect(doc(page).getByRole("img", { name: "Journey" })).toHaveCount(0);
  await expectOnce(page, ["First paragraph of Journey."]);
});

test("a picture taken while still painting goes in once it is done", async ({
  page,
}) => {
  await fakeAgent(page, SECTIONS, true);
  const { workspace, writer } = await startWriting(page, { images: true });
  await writer.getByRole("button", { name: "Start writing" }).click();
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  const painting = workspace.locator(".draft-image-pending");
  await expect(painting).toHaveCount(1);
  await painting.getByRole("button", { name: "Accept" }).click();
  await expect(painting).toContainText("Accepted");
  // Taking the picture took no text: the section still waits.
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  expect(await docText(page)).not.toContain("First paragraph of Journey.");
  await finishImages(page);
  await workspace
    .getByRole("button", { name: "Accept all", exact: true })
    .click();
  await expect(doc(page).getByRole("img", { name: "Journey" })).toHaveCount(1);
  await expectOnce(page, ["First paragraph of Journey."]);
});

test("Accept and continue never moves on past a section that couldn't go in", async ({
  page,
}) => {
  const { writer } = await startWriting(page);
  await writer.getByRole("button", { name: "Start writing" }).click();
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  // The document typed into while the section waits for review.
  await page.getByRole("button", { name: /^(Write|写作) ·/ }).click();
  await doc(page).click();
  await page.keyboard.type("A note of my own. ");
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  await expect(writer.getByRole("alert")).toContainText("couldn't go in");
  await expect(writer.locator("li.is-done")).toHaveCount(0);
  // Rewritten against the document as it is now, it goes in.
  await writer.getByPlaceholder(/Notes, e\.g\./).fill("Again");
  await writer.getByRole("button", { name: "Rewrite this section" }).click();
  await expect(writer.locator("li.is-review")).toHaveCount(1);
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  await expect(writer.locator("li.is-done")).toHaveCount(1);
  const text = await docText(page);
  expect(text).toContain("A note of my own.");
  expect(text).toContain("First paragraph of Origins (rewritten).");
});
