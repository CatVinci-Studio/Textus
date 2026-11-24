// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onPluginEvent } from "../../plugins/app-bridge";
import { openDocumentAt } from "../../registry/open-documents";
import { useSourceDocumentAccess } from "./useSourceDocumentAccess";

afterEach(cleanup);

describe("a source tab's document for plugins", () => {
  it("tells one change for text put in from outside (a reload, the AI's edit), none for its echo", () => {
    const told: string[] = [];
    const stop = onPluginEvent("documentChange", (e) => told.push(e.source));
    const onChange = vi.fn();
    const props = {
      tabId: "t1",
      content: "old",
      filePath: "/notes/a.md",
      isActive: true,
      readOnly: false,
      onChange,
    };
    const { rerender } = renderHook((p) => useSourceDocumentAccess(p), {
      initialProps: props,
    });
    const open = openDocumentAt("/notes/a.md")!;
    expect(open.replaceText("new", open.revision())).toBe(true);
    expect(onChange).toHaveBeenCalledWith("new");
    // The tab takes the text it reported: not a change of its own.
    rerender({ ...props, content: "new" });
    expect(told).toEqual(["plugin"]);
    stop();
  });
});
