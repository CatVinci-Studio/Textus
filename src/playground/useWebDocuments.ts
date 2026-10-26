import { useCallback, useEffect, useRef, useState } from "react";
import {
  indexedDbBackend,
  loadDocuments,
  memoryBackend,
  newDocument,
  notePending,
  rememberCurrent,
  type DocumentBackend,
  type WebDocument,
} from "./document-store";
import { exportFilename, saveMarkdownFile } from "./markdown-file";

/** A document's name: its file's, else its first heading's or line's. */
export function documentName(doc: WebDocument, untitled: string): string {
  return (doc.fileName ?? exportFilename(doc.markdown, untitled)).replace(
    /\.(md|markdown|txt)$/i,
    "",
  );
}

/**
 * The web editor's documents: kept in the browser, one of them open, files
 * opened from disk remembered (for this visit) so Save writes back.
 */
export function useWebDocuments(sample: string, untitled: string) {
  const backend = useRef<DocumentBackend | null>(null);
  const handles = useRef(new Map<string, FileSystemFileHandle>());
  const [docs, setDocs] = useState<WebDocument[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const store = (await indexedDbBackend()) ?? memoryBackend();
      const loaded = await loadDocuments(store, sample);
      if (!live) return;
      backend.current = store;
      setDocs(loaded.docs);
      setCurrent(loaded.current);
    })();
    return () => {
      live = false;
    };
  }, [sample]);

  const keep = (doc: WebDocument) =>
    void backend.current?.put(doc).catch(() => {});

  const select = useCallback((id: string) => {
    setCurrent(id);
    rememberCurrent(id);
  }, []);

  /** The open document's text changed. */
  const update = useCallback((id: string, markdown: string) => {
    setDocs((list) =>
      (list ?? []).map((doc) => {
        if (doc.id !== id || doc.markdown === markdown) return doc;
        const next = { ...doc, markdown, updatedAt: Date.now() };
        notePending(next);
        keep(next);
        return next;
      }),
    );
  }, []);

  const add = useCallback(
    (doc: WebDocument, handle?: FileSystemFileHandle) => {
      if (handle) handles.current.set(doc.id, handle);
      keep(doc);
      setDocs((list) => [doc, ...(list ?? [])]);
      select(doc.id);
    },
    [select],
  );

  const create = useCallback(() => add(newDocument("")), [add]);

  /** Files opened: each a document of its own, the last one in front. */
  const open = useCallback(
    (
      files: {
        markdown: string;
        name: string;
        handle?: FileSystemFileHandle;
      }[],
    ) => {
      for (const file of files)
        add(newDocument(file.markdown, file.name), file.handle);
    },
    [add],
  );

  /** Deletes a document; the last one left becomes an empty one. */
  const remove = useCallback(
    (id: string) => {
      void backend.current?.delete(id).catch(() => {});
      handles.current.delete(id);
      const rest = (docs ?? []).filter((doc) => doc.id !== id);
      if (!rest.length) {
        const empty = newDocument("");
        keep(empty);
        setDocs([empty]);
        select(empty.id);
        return;
      }
      setDocs(rest);
      if (current === id) select(rest[0].id);
    },
    [docs, current, select],
  );

  /** Saves the open document to its file, or asks where, or downloads it.
   *  The file's name, or null when cancelled or downloaded. */
  const save = useCallback(
    async (markdown: string): Promise<string | null> => {
      const doc = docs?.find((d) => d.id === current);
      if (!doc) return null;
      const result = await saveMarkdownFile(
        markdown,
        `${documentName(doc, untitled)}.md`,
        handles.current.get(doc.id) ?? null,
      );
      if (!result.handle) return null;
      handles.current.set(doc.id, result.handle);
      if (doc.fileName !== result.handle.name) {
        const named = { ...doc, fileName: result.handle.name };
        keep(named);
        setDocs((list) =>
          (list ?? []).map((d) => (d.id === doc.id ? named : d)),
        );
      }
      return result.handle.name;
    },
    [docs, current, untitled],
  );

  const doc = docs?.find((d) => d.id === current) ?? null;
  return { docs, doc, select, update, create, open, remove, save };
}
