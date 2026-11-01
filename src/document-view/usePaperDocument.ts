import { useCallback, useEffect, useRef } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Slice } from "@milkdown/kit/prose/model";
import type { EditorRunner } from "../editor/useEditorRunner";
import { paperRun, updatePaperRun } from "../ai/paper/paper-store";
import { paperPictures, placePicture } from "../ai/paper/paper-pictures";
import {
  generatedImageData,
  loadGeneratedImage,
  rememberSaved,
  savedSrc,
} from "../ai/revision/generated-images";
import type { GeneratedImageData } from "../platform/ipc";
import { paperDraft } from "../ai/paper/paper-document";
import { beginPaper, settlePaper, writePaper } from "../ai/paper/paper-write";

interface Live {
  key: string;
  original: Slice;
  frame: number;
}

/**
 * The paper as it is written, in the document: its headings once the
 * outline is approved, each section under its heading as its writer writes
 * it, and at the end the finished paper in their place, as one step Undo
 * takes back, then its pictures one by one above their captions. Writes
 * follow the paper store, at most once a frame.
 */
export function usePaperDocument(
  run: EditorRunner,
  storePicture: (
    image: GeneratedImageData,
    alt: string,
  ) => Promise<string | null>,
) {
  const live = useRef<Live | null>(null);

  const draw = useCallback(() => {
    const now = live.current;
    if (!now) return;
    now.frame = 0;
    const state = paperRun(now.key);
    if (!state?.outline) return;
    const markdown = paperDraft(
      state.topic,
      state.outline,
      state.sectionText,
      state.sources,
    );
    run((ctx) => writePaper(ctx.get(editorViewCtx), ctx, markdown));
  }, [run]);

  /** What the paper has now, shown on the next frame. */
  const update = useCallback(
    (key: string) => {
      const now = live.current;
      if (now?.key !== key || now.frame) return;
      now.frame = requestAnimationFrame(draw);
    },
    [draw],
  );

  /** The paper put in for good: `markdown`, or what was written of it when
   *  the run stopped short. */
  const settle = useCallback(
    (key: string, markdown?: string) => {
      const now = live.current;
      if (now?.key !== key) return;
      cancelAnimationFrame(now.frame);
      live.current = null;
      const state = paperRun(key);
      const text =
        markdown ??
        (state?.outline
          ? paperDraft(
              state.topic,
              state.outline,
              state.sectionText,
              state.sources,
            )
          : null);
      run((ctx) =>
        settlePaper(ctx.get(editorViewCtx), ctx, text, now.original),
      );
    },
    [run],
  );

  /** Gives paper `key` its place in the document and writes its headings.
   *  A paper still being written there is settled first. */
  const begin = useCallback(
    (key: string) => {
      if (live.current) settle(live.current.key);
      const original = run((ctx) => beginPaper(ctx.get(editorViewCtx)));
      if (!original) return;
      live.current = { key, original, frame: 0 };
      draw();
    },
    [run, draw, settle],
  );

  /** The finished paper's pictures, each saved beside the document and put
   *  above its caption as it comes: the text is there first. */
  const addPictures = useCallback(
    async (key: string, markdown: string) => {
      const pictures = paperPictures(markdown);
      let left = pictures.length;
      updatePaperRun(key, () => ({ picturesLeft: left }));
      for (const picture of pictures) {
        if (await loadGeneratedImage(picture.id)) {
          const data = generatedImageData(picture.id);
          const src =
            savedSrc(picture.id) ??
            (data ? await storePicture(data, picture.alt) : null);
          if (src) {
            rememberSaved(picture.id, src);
            run((ctx) =>
              placePicture(ctx.get(editorViewCtx), ctx, picture, src),
            );
          }
        }
        left -= 1;
        updatePaperRun(key, () => ({ picturesLeft: left }));
      }
    },
    [run, storePicture],
  );

  useEffect(
    () => () => {
      if (live.current) cancelAnimationFrame(live.current.frame);
    },
    [],
  );

  return { begin, update, settle, addPictures };
}
