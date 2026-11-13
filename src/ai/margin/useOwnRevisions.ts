import { useEffect, useRef, useState } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Transform } from "@milkdown/kit/prose/transform";
import { rejectChanges } from "./own-change-spans";
import type { EditorRunner } from "../../editor/useEditorRunner";
import { parseMarkdownSource } from "../../editor/markdown/parse-markdown-source";
import { ownNotes as ownNotesIpc } from "../../platform/ipc";
import { showConfirm } from "../../engine/controls/app-dialog";
import { useWindowEvent } from "../../utils/hooks/useWindowEvent";
import { useLatest } from "../../utils/hooks/useLatest";
import {
  TRACK_CHANGES_EVENT,
  type TrackChangesAction,
} from "../../utils/events";
import type { Strings } from "../../i18n/strings";
import {
  ownRevisionKey,
  setOwnPicker,
  watchOwnChanges,
  type OwnChange,
} from "./own-revision-plugin";
import { setTrackingShown } from "./track-changes-state";
import { originalChanged, trackFile } from "../../document/tracked-file";
import { reportUndecided } from "../../document/undecided";

/** Track My Changes for one document. The file holds the original with the
 *  changes accepted; the changes still undecided are kept beside it
 *  (document/tracked-file.ts), so tracking carries on when it reopens. */
export function useOwnRevisions({
  isActive,
  run,
  filePath,
  t,
}: {
  /** The document on screen, the one the menu's items act on. */
  isActive: boolean;
  run: EditorRunner;
  filePath: string | null;
  t: Strings;
}) {
  // Null while the document isn't tracking.
  const [changes, setChanges] = useState<OwnChange[] | null>(null);
  const loadedFor = useRef<string | null>(null);
  // The original last seen, so only a change to it writes the file.
  const baseSeen = useRef<ProseNode | null>(null);
  // The original as the file spells it, while it is the one tracked.
  const keptText = useRef<{ base: ProseNode; text: string } | null>(null);

  const view = run((ctx) => ctx.get(editorViewCtx)) ?? null;
  useEffect(() => {
    if (!view) return;
    return watchOwnChanges(view, setChanges);
  }, [view]);

  // The ✓ / ✕ in the text.
  const decideRef = useLatest(decide);
  useEffect(() => {
    if (!view) return;
    return setOwnPicker(view, {
      labels: { take: t.proposalTakeSentence, keep: t.proposalKeepSentence },
      decide: (index, take) => decideRef.current(index, take),
    });
  }, [view, t, decideRef]);

  // The menu's check mark follows the document on screen.
  useEffect(() => {
    if (!view || !isActive) return;
    setTrackingShown(changes !== null);
  });

  // The original kept beside the file: tracking carries on where the file
  // still holds it and the editor opened with the revised text.
  useEffect(() => {
    if (!filePath || !view || loadedFor.current === filePath) return;
    if (loadedFor.current !== null || changes !== null) {
      // Saved under a new name: its tracking goes along.
      loadedFor.current = filePath;
      return;
    }
    let alive = true;
    void ownNotesIpc
      .read(filePath, "revisions")
      .catch(() => null)
      .then((text) => {
        if (!alive) return;
        loadedFor.current = filePath;
        // Most files keep no original: nothing to serialize the document for.
        if (!text) return;
        run((ctx) => {
          const serialize = ctx.get(serializerCtx);
          const kept = keptOriginal(text, serialize(view.state.doc), (md) => {
            const doc = parseMarkdownSource(ctx, md);
            return doc ? serialize(doc) : md;
          });
          if (kept === null) return;
          const base = parseMarkdownSource(ctx, kept);
          if (!base) return;
          // Until a change is accepted the file keeps the original as written.
          keptText.current = { base, text: kept };
          view.dispatch(
            view.state.tr.setMeta(ownRevisionKey, { type: "base", base }),
          );
          baseSeen.current = base;
        });
      });
    return () => {
      alive = false;
    };
  }, [filePath, view, run, changes]);

  useEffect(() => {
    if (filePath) reportUndecided(filePath, "own", changes?.length ?? 0);
  }, [filePath, changes]);

  // What the file holds while tracked: the original.
  useEffect(() => {
    if (!filePath || !view) return;
    return trackFile(filePath, () => {
      const base = ownRevisionKey.getState(view.state)?.base;
      if (!base) return null;
      if (keptText.current?.base === base) return keptText.current.text;
      return run((ctx) => ctx.get(serializerCtx)(base)) ?? null;
    });
  }, [filePath, view, run]);

  // A change accepted, or tracking started or stopped: the file follows.
  useEffect(() => {
    if (!filePath || !view || loadedFor.current !== filePath) return;
    const base = ownRevisionKey.getState(view.state)?.base ?? null;
    if (baseSeen.current === base) return;
    baseSeen.current = base;
    originalChanged(filePath);
  }, [filePath, view, changes]);

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
    const s = state();
    if (!view || !s?.base) return;
    const tr = view.state.tr;
    rejectChanges(tr, s.shown, s.base);
    if (tr.docChanged) view.dispatch(tr);
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
    if (!view || !isActive) return;
    const action = (e as CustomEvent<TrackChangesAction>).detail;
    if (action === "toggle") void toggle();
    else if (action === "accept-all") acceptAll();
    else if (action === "reject-all") rejectAll();
  });

  return { changes, decide, acceptAll, rejectAll, toggle };
}

/**
 * The original kept beside a file (`text`, as stored) that tracking carries
 * on from, or null. Changes revised from text the editor no longer shows
 * give way, as a proposal does; one kept from before 1.3 has no revised
 * text and always carries on. The revised text is as the tab saved it, in
 * the writer's own spelling: `same` writes it as `shown` is written.
 */
export function keptOriginal(
  text: string | null,
  shown: string,
  same: (markdown: string) => string = (markdown) => markdown,
): string | null {
  let saved: { base?: unknown; revised?: unknown };
  try {
    saved = text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
  if (typeof saved.base !== "string") return null;
  if (typeof saved.revised === "string" && same(saved.revised) !== shown)
    return null;
  return saved.base;
}
