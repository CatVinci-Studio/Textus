// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPEN_CREATE_EVENT,
  onCreateRequest,
  requestCreate,
  takeCreateRequest,
} from "./create-request";
import { askAi } from "./ask-ai";

afterEach(() => void takeCreateRequest());

describe("a request for Create", () => {
  it("opens Settings at Create when no Create tab is open, and waits there", () => {
    const opened = vi.fn();
    window.addEventListener(OPEN_CREATE_EVENT, opened);
    requestCreate("Change the plugin", "plugin");
    window.removeEventListener(OPEN_CREATE_EVENT, opened);
    expect(opened).toHaveBeenCalledOnce();
    expect(takeCreateRequest()).toEqual({
      text: "Change the plugin",
      kind: "plugin",
    });
    expect(takeCreateRequest()).toBeNull();
  });

  it("goes to the open Create tab, keeping Settings as it is", () => {
    const opened = vi.fn();
    const taken: unknown[] = [];
    window.addEventListener(OPEN_CREATE_EVENT, opened);
    const stop = onCreateRequest(() => taken.push(takeCreateRequest()));
    requestCreate("Fix it", "plugin");
    stop();
    window.removeEventListener(OPEN_CREATE_EVENT, opened);
    expect(taken).toEqual([{ text: "Fix it", kind: "plugin" }]);
    expect(opened).not.toHaveBeenCalled();
  });

  it("is what asking the AI in Create mode does, not the document's panel", () => {
    askAi("Fix the plugin", "create");
    expect(takeCreateRequest()).toEqual({
      text: "Fix the plugin",
      kind: "plugin",
    });
  });
});
