// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorViewCtx, serializerCtx, type Editor } from "@milkdown/kit/core";
import type {
  ImageJob,
  ImageTaskPermission,
  ImageGenerationRequest,
} from "../platform/ipc";
const api = vi.hoisted(() => ({
  cancelImageGeneration: vi.fn(async () => {}),
  imageJobs: vi.fn(),
  startImage: vi.fn(),
  prepareImage: vi.fn(),
  finishImage: vi.fn(),
  cancelImage: vi.fn(),
}));
vi.mock("../platform/ipc", async (original) => ({
  ...(await original<typeof import("../platform/ipc")>()),
  media: api,
}));
import { createTestEditor } from "./editor-test-harness";
import { useDocumentWorkspace } from "./useDocumentWorkspace";
import { useDocumentImages } from "./useDocumentImages";
import type { EditorRunner } from "../editor/useEditorRunner";
let editor: Editor | undefined;
let records: ImageJob[];
beforeEach(() => {
  records = [];
  vi.clearAllMocks();
  api.imageJobs.mockImplementation(async () => [...records]);
  api.startImage.mockImplementation(
    async (
      permission: ImageTaskPermission,
      request: ImageGenerationRequest,
    ) => {
      const job: ImageJob = {
        jobId: `image-${records.length}`,
        taskId: permission.taskId,
        documentId: permission.documentId,
        baseRevision: permission.baseRevision,
        sequence: records.length + 1,
        request,
        status: "ready",
        previewPath: "/tmp/image.png",
        error: null,
        model: "test",
        width: 1,
        height: 1,
        assetSrc: null,
      };
      records.push(job);
      return job;
    },
  );
  api.prepareImage.mockResolvedValue("assets/generated.png");
  api.finishImage.mockImplementation(async (id: string, accepted: boolean) => {
    records = records.map((job) =>
      job.jobId === id
        ? {
            ...job,
            status: accepted ? "committed" : "ready",
            assetSrc: accepted ? "assets/generated.png" : null,
          }
        : job,
    );
  });
});
afterEach(async () => {
  cleanup();
  await editor?.destroy();
  editor = undefined;
});
async function setup() {
  editor = await createTestEditor("## Section\n\nOriginal.");
  const run: EditorRunner = (callback) => editor!.action(callback);
  const hook = renderHook(
    ({ path }) => {
      const workspace = useDocumentWorkspace(run, "document");
      const images = useDocumentImages(
        run,
        "document",
        path,
        workspace,
        "session",
      );
      return { workspace, images };
    },
    { initialProps: { path: "/docs/article.md" } },
  );
  await act(() =>
    hook.result.current.images.start({
      prompt: "Diagram",
      anchor: "## Section",
      alt: "Diagram",
    }),
  );
  await waitFor(() => expect(hook.result.current.images.jobs).toHaveLength(1));
  return { ...hook, run };
}
it("inserts a reviewed local asset through the document transaction", async () => {
  const { result, run } = await setup();
  await act(() => result.current.images.accept(result.current.images.jobs[0]));
  expect(api.finishImage).toHaveBeenCalledWith("image-0", true);
  expect(
    run((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)),
  ).toContain("assets/generated.png");
});
it("stops an image generation before a deferred start reaches the frontend cache", async () => {
  const { result } = await setup();
  let resolve!: (job: ImageJob) => void;
  api.startImage.mockReturnValueOnce(
    new Promise<ImageJob>((r) => {
      resolve = r;
    }),
  );
  let starting!: Promise<ImageJob | undefined>;
  act(() => {
    starting = result.current.images.start({
      prompt: "Delayed",
      anchor: "## Section",
      alt: "Delayed",
    });
  });
  expect(result.current.images.pending).toBe(true);
  await act(() => result.current.images.stopRunning());
  expect(api.cancelImageGeneration).toHaveBeenCalledWith(
    expect.objectContaining({
      documentId: "document",
      taskId: result.current.workspace.draft?.id,
      generationId: expect.any(String),
    }),
  );
  await act(async () => {
    resolve({ ...records[0], jobId: "late-image", status: "queued" });
    await starting;
  });
  expect(
    result.current.images.jobs.some(
      (job) => job.jobId === "late-image" && job.status === "queued",
    ),
  ).toBe(false);
});
it("rolls back the prepared asset if the user types while the asset is saving", async () => {
  const { result, run } = await setup();
  let resolve!: (src: string) => void;
  api.prepareImage.mockReturnValue(
    new Promise<string>((r) => {
      resolve = r;
    }),
  );
  let inserting!: Promise<unknown>;
  act(() => {
    inserting = result.current.images.accept(result.current.images.jobs[0]);
  });
  act(() =>
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText("Manual ", 1));
    }),
  );
  await act(async () => {
    resolve("assets/generated.png");
    await inserting;
  });
  expect(api.finishImage).toHaveBeenCalledWith("image-0", false);
  expect(
    run((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)),
  ).toContain("Manual");
  expect(
    run((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)),
  ).not.toContain("generated.png");
});
it("serializes double-clicked acceptance before React rerenders", async () => {
  const { result } = await setup();
  let resolve!: (src: string) => void;
  api.prepareImage.mockReturnValue(
    new Promise<string>((r) => {
      resolve = r;
    }),
  );
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.images.accept(result.current.images.jobs[0]);
    void result.current.images.accept(result.current.images.jobs[0]);
  });
  expect(api.prepareImage).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve("assets/generated.png");
    await pending;
  });
});
it("rolls back an asset prepared for a different folder after Save As", async () => {
  const { result, rerender, run } = await setup();
  let resolve!: (src: string) => void;
  api.prepareImage.mockReturnValue(
    new Promise<string>((r) => {
      resolve = r;
    }),
  );
  let inserting!: Promise<unknown>;
  act(() => {
    inserting = result.current.images.accept(result.current.images.jobs[0]);
  });
  rerender({ path: "/other/article.md" });
  await act(async () => {
    resolve("assets/generated.png");
    await inserting;
  });
  expect(api.finishImage).toHaveBeenCalledWith("image-0", false);
  expect(
    run((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)),
  ).not.toContain("generated.png");
});
it("preserves sequence at a shared anchor regardless of completion order", async () => {
  const { result, run } = await setup();
  api.prepareImage.mockImplementation(async (id: string) => `assets/${id}.png`);
  api.finishImage.mockImplementation(async (id: string, accepted: boolean) => {
    records = records.map((job) =>
      job.jobId === id
        ? {
            ...job,
            status: accepted ? "committed" : "ready",
            assetSrc: accepted ? `assets/${id}.png` : null,
          }
        : job,
    );
  });
  await act(() =>
    result.current.images.start({
      prompt: "Second diagram",
      anchor: "## Section",
      alt: "Second diagram",
    }),
  );
  expect(result.current.images.canAccept(result.current.images.jobs[1])).toBe(
    false,
  );
  await act(() => result.current.images.accept(result.current.images.jobs[1]));
  expect(api.prepareImage).not.toHaveBeenCalled();
  await act(() => result.current.images.accept(result.current.images.jobs[0]));
  expect(result.current.images.canAccept(result.current.images.jobs[1])).toBe(
    true,
  );
  await act(() => result.current.images.accept(result.current.images.jobs[1]));
  const markdown = run((ctx) =>
    ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
  )!;
  expect(markdown.indexOf("image-0.png")).toBeLessThan(
    markdown.indexOf("image-1.png"),
  );
  expect(markdown).toContain("Original.");
});
it("a historical failed image does not silently block a new selection illustration", async () => {
  const { result } = await setup();
  records = records.map((job) => ({
    ...job,
    status: "failed",
    error: "Prompt too long",
  }));
  await act(async () => {
    await result.current.images.refresh();
  });
  expect(result.current.images.pending).toBe(false);
  await act(async () => {
    await result.current.images.start({
      prompt: "A concise forest composition",
      anchor: "## Section",
      alt: "Forest",
    });
  });
  expect(api.startImage).toHaveBeenCalledTimes(2);
});
it("cancels its pictures when the editor goes, not when an effect merely re-runs", async () => {
  editor = await createTestEditor("## Section\n\nOriginal.");
  const run: EditorRunner = (callback) => editor!.action(callback);
  const hook = renderHook(
    ({ id }) => {
      const workspace = useDocumentWorkspace(run, "document");
      return useDocumentImages(run, id, null, workspace, "session");
    },
    { initialProps: { id: "document" } },
  );
  act(() => {
    hook.result.current.authorizeTask("task", 0);
  });
  api.cancelImageGeneration.mockClear();
  // The effect's cleanup and setup run again (as on a hot reload): the
  // picture still painting is kept.
  hook.rerender({ id: "document-again" });
  await act(() => new Promise((r) => setTimeout(r, 10)));
  // (An earlier test's closed editor may cancel its own meanwhile.)
  expect(api.cancelImageGeneration).not.toHaveBeenCalledWith(
    expect.objectContaining({ taskId: "task" }),
  );
  hook.unmount();
  await act(() => new Promise((r) => setTimeout(r, 10)));
  expect(api.cancelImageGeneration).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: "task" }),
  );
});
