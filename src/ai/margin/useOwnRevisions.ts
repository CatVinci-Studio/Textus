import { useEffect, useRef, useState } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { Slice, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { Transform } from "@milkdown/kit/prose/transform";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { EditorRunner } from "../../editor/useEditorRunner";
import { parseMarkdownSource } from "../../editor/markdown/parse-markdown-source";
import { ownNotes as ownNotesIpc } from "../../platform/ipc";
import { showConfirm } from "../../ui/app-dialog";
import { useWindowEvent } from "../../utils/hooks/useWindowEvent";
import {
  TRACK_CHANGES_EVENT,
  type TrackChangesAction,
} from "../../utils/events";
import type { Strings } from "../../i18n/strings";
import {
  ownRevisionKey,
  watchOwnChanges,
  type OwnChange,
} from "./own-revision-plugin";
import { setTrackingShown } from "./track-changes-state";

/** A moment after the last change, the original is written. */
const WRITE_AFTER = 400;

const onScreen = (view: EditorView) =>
  !!view.dom.closest('[data-active-tab="true"]');

/**
 * Track My Changes for one document (own-revision-plugin.ts): turned on
 * and off from Edit › Track My Changes, its changes listed for the margin,
 * each accepted (it becomes part of the original) or rejected (the text
 * goes back). While a document tracks, its original is kept beside the
 * app's data (own_notes.rs, part "revisions") and tracking carries on
 * when it opens again; the file itself always holds the new text.
 */
export function useOwnRevisions({
  run,
  filePath,
  t,
}: {
  run: EditorRunner;
  filePath: string | null;
  t: Strings;
}) {
  // Null while the document isn't tracking.
  const [changes, setChanges] = useState<OwnChange[] | null>(null);
  const loadedFor = useRef<string | null>(null);
  const written = useRef<{ base: ProseNode | null; text: string } | null>(null);

  const view = run((ctx) => ctx.get(editorViewCtx)) ?? null;
  useEffect(() => {
    if (!view) return;
    return watchOwnChanges(view, setChanges);
  }, [view]);

  // The menu's check mark follows the document on screen.
  useEffect(() => {
    if (!view || !onScreen(view)) return;
    setTrackingShown(changes !== null);
  });

  useEffect(() => {
    if (!filePath || !view || loadedFor.current === filePath) return;
    if (loadedFor.current !== null || changes !== null) {
      // Saved under a new name: its tracking goes along.
      loadedFor.current = filePath;
      written.current = null;
      return;
    }
    let alive = true;
    void ownNotesIpc
      .read(filePath, "revisions")
      .catch(() => null)
      .then((text) => {
        if (!alive) return;
        loadedFor.current = filePath;
        let markdown: unknown = null;
        try {
          markdown = text
            ? (JSON.parse(text) as { base?: unknown }).base
            : null;
        } catch {
          markdown = null;
        }
        if (typeof markdown !== "string") {
          written.current = { base: null, text: "{}" };
          return;
        }
        run((ctx) => {
          const base = parseMarkdownSource(ctx, markdown as string);
          if (!base || typeof base === "string") return;
          view.dispatch(
            view.state.tr.setMeta(ownRevisionKey, { type: "base", base }),
          );
          written.current = { base, text: text ?? "" };
        });
      });
    return () => {
      alive = false;
    };
  }, [filePath, view, run, changes]);

  useEffect(() => {
    if (!filePath || !view || loadedFor.current !== filePath) return;
    const base = ownRevisionKey.getState(view.state)?.base ?? null;
    if (written.current?.base === base) return;
    const timer = window.setTimeout(() => {
      const text = base
        ? JSON.stringify({
            base: run((ctx) => ctx.get(serializerCtx)(base)) ?? "",
          })
        : "{}";
      written.current = { base, text };
      void ownNotesIpc.write(filePath, "revisions", text).catch(() => {
        written.current = null;
      });
    }, WRITE_AFTER);
    return () => window.clearTimeout(timer);
  }, [filePath, view, run, changes]);

  const state = () => (view ? ownRevisionKey.getState(view.state) : undefined);

  /** Accepts (true) or rejects (false) the change at `index`. */
  function decide(index: number, take: boolean | null) {
    const s = state();
    const change = s?.shown[index];
    if (!view || !s?.base || !change || take === null) return;
    const doc = view.state.doc;
    if (take) {
      const base = new Transform(s.base).replace(
        change.fromA,
        change.toA,
        doc.slice(change.fromB, change.toB),
      ).doc;
      view.dispatch(
        view.state.tr.setMeta(ownRevisionKey, { type: "base", base }),
      );
    } else {
      view.dispatch(
        view.state.tr.replace(
          change.fromB,
          change.toB,
          s.base.slice(change.fromA, change.toA),
        ),
      );
    }
  }

  function acceptAll() {
    if (!view || !state()?.base) return;
    view.dispatch(
      view.state.tr.setMeta(ownRevisionKey, {
        type: "base",
        base: view.state.doc,
      }),
    );
  }

  function rejectAll() {
    const base = state()?.base;
    if (!view || !base) return;
    view.dispatch(
      view.state.tr.replace(
        0,
        view.state.doc.content.size,
        new Slice(base.content, 0, 0),
      ),
    );
  }

  async function toggle() {
    if (!view) return;
    if (!state()?.base) {
      view.dispatch(view.state.tr.setMeta(ownRevisionKey, { type: "start" }));
      return;
    }
    if (
      changes?.length &&
      !(await showConfirm(t.trackStopConfirm, {
        title: t.menuTrackChanges,
        okLabel: t.trackStop,
        cancelLabel: t.cancel,
      }))
    )
      return;
    view.dispatch(view.state.tr.setMeta(ownRevisionKey, { type: "stop" }));
  }

  useWindowEvent(TRACK_CHANGES_EVENT, (e) => {
    if (!view || !onScreen(view)) return;
    const action = (e as CustomEvent<TrackChangesAction>).detail;
    if (action === "toggle") void toggle();
    else if (action === "accept-all") acceptAll();
    else if (action === "reject-all") rejectAll();
  });

  return { changes, decide, acceptAll, rejectAll, toggle };
}
