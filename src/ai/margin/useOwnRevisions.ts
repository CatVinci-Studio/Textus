import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
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
import {
  leaveTracked,
  leftTracked,
  originalChanged,
  trackFile,
} from "../../document/tracked-file";
import { reportUndecided } from "../../document/undecided";

type Kept = {
  current: {
    loadedFor: string | null;
    baseSeen: ProseNode | null;
    text: { base: ProseNode; text: string } | null;
  };
};

/** The changes tracked in `view`; null while it isn't tracking. */
function useOwnChanges(view: EditorView | null) {
  const [changes, setChanges] = useState<OwnChange[] | null>(null);
  useEffect(() => {
    if (!view) return;
    return watchOwnChanges(view, setChanges);
  }, [view]);
  return changes;
}

/** The ✓ / ✕ in the text. */
function useOwnPicker(
  view: EditorView | null,
  t: Strings,
  decide: (index: number, take: boolean | null) => void,
) {
  const decideRef = useLatest(decide);
  useEffect(() => {
    if (!view) return;
    return setOwnPicker(view, {
      labels: { take: t.proposalTakeSentence, keep: t.proposalKeepSentence },
      decide: (index, take) => decideRef.current(index, take),
    });
  }, [view, t, decideRef]);
}

/** What the file holds while tracked, the original, kept for its file;
 *  when the editor goes (its tab out of sight) with the document still
 *  open, written out while the editor is there to write it. */
function useOriginalKept(
  filePath: string | null,
  view: EditorView | null,
  run: EditorRunner,
  kept: Kept,
) {
  const original = useLatest(() => {
    const base = view && ownRevisionKey.getState(view.state)?.base;
    if (!base) return null;
    const text = kept.current.text;
    if (text?.base === base) return text.text;
    return run((ctx) => ctx.get(serializerCtx)(base)) ?? null;
  });
  useEffect(() => {
    if (!filePath || !view) return;
    return trackFile(filePath, () => original.current());
  }, [filePath, view, original]);
  const pathNow = useLatest(filePath);
  useLayoutEffect(
    () => () => {
      if (pathNow.current) leaveTracked(pathNow.current, original.current());
    },
    [pathNow, original],
  );
}

/** The Track Changes menu: its check mark follows the document on screen,
 *  and its items act on it. */
function useTrackMenu({
  view,
  isActive,
  changes,
  toggle,
  acceptAll,
  rejectAll,
}: {
  view: EditorView | null;
  isActive: boolean;
  changes: OwnChange[] | null;
  toggle: () => Promise<void>;
  acceptAll: () => void;
  rejectAll: () => void;
}) {
  useEffect(() => {
    if (!view || !isActive) return;
    setTrackingShown(changes !== null);
  });

  useWindowEvent(TRACK_CHANGES_EVENT, (e) => {
    if (!view || !isActive) return;
    const action = (e as CustomEvent<TrackChangesAction>).detail;
    if (action === "toggle") void toggle();
    else if (action === "accept-all") acceptAll();
    else if (action === "reject-all") rejectAll();
  });
}

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
  const view = run((ctx) => ctx.get(editorViewCtx)) ?? null;
  const changes = useOwnChanges(view);
  // Where it was read from, the original last seen (so only a change to it
  // writes the file), and the original as the file spells it while it is
  // the one tracked.
  const kept = useRef<{
    loadedFor: string | null;
    baseSeen: ProseNode | null;
    text: { base: ProseNode; text: string } | null;
  }>({ loadedFor: null, baseSeen: null, text: null });

  useOwnPicker(view, t, decide);

  // The original kept beside the file: tracking carries on where the file
  // still holds it and the editor opened with the revised text.
  useEffect(() => {
    if (!filePath || !view || kept.current.loadedFor === filePath) return;
    if (kept.current.loadedFor !== null || changes !== null) {
      // Saved under a new name: its tracking goes along.
      kept.current.loadedFor = filePath;
      return;
    }
    const track = (original: string) =>
      run((ctx) => {
        const base = parseMarkdownSource(ctx, original);
        if (!base) return;
        // Until a change is accepted the file keeps the original as written.
        kept.current.text = { base, text: original };
        view.dispatch(
          view.state.tr.setMeta(ownRevisionKey, { type: "base", base }),
        );
        kept.current.baseSeen = base;
      });
    // The tab's last editor was tracking: this one carries on from there.
    const from = leftTracked(filePath);
    if (from !== null) {
      kept.current.loadedFor = filePath;
      track(from);
      return;
    }
    let alive = true;
    void ownNotesIpc
      .read(filePath, "revisions")
      .catch(() => null)
      .then((text) => {
        if (!alive) return;
        kept.current.loadedFor = filePath;
        // Most files keep no original: nothing to serialize the document for.
        if (!text) return;
        run((ctx) => {
          const serialize = ctx.get(serializerCtx);
          const kept = keptOriginal(text, serialize(view.state.doc), (md) => {
            const doc = parseMarkdownSource(ctx, md);
            return doc ? serialize(doc) : md;
          });
          if (kept !== null) track(kept);
        });
      });
    return () => {
      alive = false;
    };
  }, [filePath, view, run, changes]);

  useEffect(() => {
    if (filePath) reportUndecided(filePath, "own", changes?.length ?? 0);
  }, [filePath, changes]);

  useOriginalKept(filePath, view, run, kept);

  // A change accepted, or tracking started or stopped: the file follows.
  useEffect(() => {
    if (!filePath || !view || kept.current.loadedFor !== filePath) return;
    const base = ownRevisionKey.getState(view.state)?.base ?? null;
    if (kept.current.baseSeen === base) return;
    kept.current.baseSeen = base;
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

  useTrackMenu({ view, isActive, changes, toggle, acceptAll, rejectAll });

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
