import { describe, expect, it } from "vitest";
import { DOCUMENT_KEY, loadDocument, saveDocument } from "./document-store";

function memoryStore() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
}

describe("the playground's saved document", () => {
  it("is absent on a first visit", () => {
    expect(loadDocument(memoryStore())).toBeNull();
  });

  it("comes back as it was saved, empty included", () => {
    const store = memoryStore();
    saveDocument("# Notes\n\n- one\n", store);
    expect(store.items.get(DOCUMENT_KEY)).toBe("# Notes\n\n- one\n");
    expect(loadDocument(store)).toBe("# Notes\n\n- one\n");
    // Deleting everything is an edit, not a first visit.
    saveDocument("", store);
    expect(loadDocument(store)).toBe("");
  });

  it("survives a browser that refuses storage", () => {
    const refusing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => saveDocument("text", refusing)).not.toThrow();
    expect(loadDocument(refusing)).toBeNull();
    expect(loadDocument(null)).toBeNull();
  });
});
