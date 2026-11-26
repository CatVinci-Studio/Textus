// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  onCreateAsked,
  onCreateRequest,
  requestCreate,
  requestWorkshop,
  takeCreateRequest,
} from "./create-request";
import { askAi } from "./ask-ai";

afterEach(() => void takeCreateRequest());

describe("a request for Create", () => {
  it("opens Settings at Create when no Create tab is open, and waits there", () => {
    const opened = vi.fn();
    const stopAsked = onCreateAsked(opened);
    requestCreate("Change the plugin", "plugin");
    stopAsked();
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
    const stopAsked = onCreateAsked(opened);
    const stop = onCreateRequest(() => taken.push(takeCreateRequest()));
    requestCreate("Fix it", "plugin");
    stop();
    stopAsked();
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

describe("the theme workshop asked for", () => {
  it("opens on a theme and brings the open Create tab to the front", () => {
    const opened = vi.fn();
    const taken: unknown[] = [];
    const stopAsked = onCreateAsked(opened);
    const stop = onCreateRequest(() => taken.push(takeCreateRequest()));
    requestWorkshop("user-1");
    stop();
    stopAsked();
    expect(taken).toEqual([{ text: "", kind: "theme", start: "user-1" }]);
    expect(opened).toHaveBeenCalledOnce();
  });
});
