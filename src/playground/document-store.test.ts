import { describe, expect, it } from "vitest";
import {
  LEGACY_KEY,
  loadDocuments,
  memoryBackend,
  newDocument,
  notePending,
  rememberCurrent,
} from "./document-store";

function storage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe("loadDocuments", () => {
  it("starts a first visit from the sample, kept", async () => {
    const backend = memoryBackend();
    const { docs, current } = await loadDocuments(
      backend,
      "# Sample",
      storage(),
    );
    expect(docs.map((d) => d.markdown)).toEqual(["# Sample"]);
    expect(current).toBe(docs[0].id);
    expect(await backend.all()).toHaveLength(1);
  });

  it("brings the first web editor's one document over", async () => {
    const { docs } = await loadDocuments(
      memoryBackend(),
      "# Sample",
      storage({ [LEGACY_KEY]: "My old note" }),
    );
    expect(docs.map((d) => d.markdown)).toEqual(["My old note"]);
  });

  it("lists the newest first and opens the one open last time", async () => {
    const older = { ...newDocument("a"), updatedAt: 1 };
    const newer = { ...newDocument("b"), updatedAt: 2 };
    const store = storage();
    rememberCurrent(older.id, store);
    const { docs, current } = await loadDocuments(
      memoryBackend([older, newer]),
      "# Sample",
      store,
    );
    expect(docs.map((d) => d.markdown)).toEqual(["b", "a"]);
    expect(current).toBe(older.id);
  });

  it("opens the newest when the one remembered is gone", async () => {
    const doc = newDocument("a");
    const store = storage();
    rememberCurrent("gone", store);
    const { current } = await loadDocuments(memoryBackend([doc]), "", store);
    expect(current).toBe(doc.id);
  });
});

describe("the pending copy", () => {
  it("wins over a kept document it is newer than", async () => {
    const doc = { ...newDocument("before"), updatedAt: 1 };
    const store = storage();
    notePending({ ...doc, markdown: "after", updatedAt: 2 }, store);
    const backend = memoryBackend([doc]);
    const { docs } = await loadDocuments(backend, "", store);
    expect(docs[0].markdown).toBe("after");
    expect((await backend.all())[0].markdown).toBe("after");
  });
});
