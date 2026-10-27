/**
 * The web editor's documents, kept in this browser: IndexedDB, or memory
 * where the browser refuses storage (the documents then last as long as
 * the page). Nothing is sent anywhere.
 */

export interface WebDocument {
  id: string;
  markdown: string;
  /** The file it was opened from, for its name. */
  fileName?: string;
  updatedAt: number;
}

/** Where the documents are kept: IndexedDB in the page, memory in tests. */
export interface DocumentBackend {
  all(): Promise<WebDocument[]>;
  put(doc: WebDocument): Promise<void>;
  delete(id: string): Promise<void>;
}

/** The single document of the first web editor, moved in on first load. */
export const LEGACY_KEY = "textus-playground:document";
const CURRENT_KEY = "textus-playground:current";
/** The open document's latest text, written at once: IndexedDB's write
 *  may not finish before the tab closes. */
const PENDING_KEY = "textus-playground:pending";

export function memoryBackend(docs: WebDocument[] = []): DocumentBackend {
  const kept = new Map(docs.map((doc) => [doc.id, doc]));
  return {
    all: async () => [...kept.values()],
    put: async (doc) => void kept.set(doc.id, doc),
    delete: async (id) => void kept.delete(id),
  };
}

const DB = "textus-web";
const STORE = "documents";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB, or null where the browser has none or refuses it. */
export async function indexedDbBackend(): Promise<DocumentBackend | null> {
  try {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () =>
      open.result.createObjectStore(STORE, { keyPath: "id" });
    const db = await request(open);
    const store = (mode: IDBTransactionMode) =>
      db.transaction(STORE, mode).objectStore(STORE);
    return {
      all: () =>
        request(store("readonly").getAll() as IDBRequest<WebDocument[]>),
      put: async (doc) => void (await request(store("readwrite").put(doc))),
      delete: async (id) => void (await request(store("readwrite").delete(id))),
    };
  } catch {
    return null;
  }
}

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function newDocument(markdown: string, fileName?: string): WebDocument {
  return {
    id: crypto.randomUUID(),
    markdown,
    fileName,
    updatedAt: Date.now(),
  };
}

/**
 * The documents to start with, newest first, and the one to open: the one
 * open last time, else the newest. A first visit gets `sample`; the first
 * web editor's one document comes over once.
 */
export async function loadDocuments(
  backend: DocumentBackend,
  sample: string,
  store = local(),
): Promise<{ docs: WebDocument[]; current: string }> {
  let docs = await backend.all().catch(() => [] as WebDocument[]);
  if (!docs.length) {
    let legacy: string | null = null;
    try {
      legacy = store?.getItem(LEGACY_KEY) ?? null;
    } catch {
      // No storage: start from the sample.
    }
    const first = newDocument(legacy ?? sample);
    await backend.put(first).catch(() => {});
    docs = [first];
  }
  try {
    const pending = JSON.parse(
      store?.getItem(PENDING_KEY) ?? "null",
    ) as WebDocument | null;
    const kept = docs.find((doc) => doc.id === pending?.id);
    if (pending && kept && pending.updatedAt > kept.updatedAt) {
      docs = docs.map((doc) => (doc === kept ? { ...kept, ...pending } : doc));
      await backend.put({ ...kept, ...pending }).catch(() => {});
    }
  } catch {
    // Nothing pending, or not readable.
  }
  docs.sort((a, b) => b.updatedAt - a.updatedAt);
  let current: string | null = null;
  try {
    current = store?.getItem(CURRENT_KEY) ?? null;
  } catch {
    // Nothing remembered.
  }
  if (!docs.some((doc) => doc.id === current)) current = docs[0].id;
  return { docs, current: current as string };
}

export function rememberCurrent(id: string, store = local()): void {
  try {
    store?.setItem(CURRENT_KEY, id);
  } catch {
    // Not remembered: the newest opens next time.
  }
}

/** Keeps the open document's latest text until IndexedDB has it. */
export function notePending(doc: WebDocument, store = local()): void {
  try {
    store?.setItem(
      PENDING_KEY,
      JSON.stringify({
        id: doc.id,
        markdown: doc.markdown,
        updatedAt: doc.updatedAt,
      }),
    );
  } catch {
    // No room: IndexedDB's own write is all there is.
  }
}
