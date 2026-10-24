import { describe, expect, it } from "vitest";
import { draftProposal, parsePartialToolArgs } from "./partial-tool-args";

describe("parsePartialToolArgs", () => {
  it("reads complete flat string fields", () => {
    const fields = parsePartialToolArgs(
      '{"action":"replace","anchor":"old text","text":"new text"}',
    );
    expect(fields.action).toEqual({ value: "replace", complete: true });
    expect(fields.anchor).toEqual({ value: "old text", complete: true });
    expect(fields.text).toEqual({ value: "new text", complete: true });
  });

  it("marks a value cut off mid-way as incomplete", () => {
    const fields = parsePartialToolArgs('{"action":"replace","text":"par');
    expect(fields.action?.complete).toBe(true);
    expect(fields.text).toEqual({ value: "par", complete: false });
  });

  it("survives a fragment ending inside an escape or mid-key", () => {
    expect(parsePartialToolArgs('{"text":"line\\')).toEqual({
      text: { value: "line", complete: false },
    });
    expect(parsePartialToolArgs('{"text":"a\\u00')).toEqual({
      text: { value: "a", complete: false },
    });
    expect(parsePartialToolArgs('{"act')).toEqual({});
  });

  it("decodes escapes and unicode, including CJK and surrogate pairs", () => {
    const fields = parsePartialToolArgs(
      '{"text":"a\\"b\\n中文\\u4f60\\ud83d\\ude00"}',
    );
    expect(fields.text).toEqual({ value: 'a"b\n中文你😀', complete: true });
  });

  it("skips non-string values without derailing later fields", () => {
    const fields = parsePartialToolArgs('{"count":3,"text":"hi"}');
    expect(fields.text).toEqual({ value: "hi", complete: true });
  });

  it("returns nothing for a fragment that is not yet an object", () => {
    expect(parsePartialToolArgs("")).toEqual({});
    expect(parsePartialToolArgs("   ")).toEqual({});
  });
});

describe("draftProposal", () => {
  it("is null until the action (and anchor, when needed) are complete", () => {
    expect(draftProposal('{"action":"repl')).toBeNull();
    expect(draftProposal('{"action":"replace","anchor":"tar')).toBeNull();
    expect(draftProposal('{"action":"not_an_action","text":"x"}')).toBeNull();
  });

  it("places an anchored action once the anchor closes, text still growing", () => {
    const draft = draftProposal(
      '{"action":"insert_after","anchor":"## Intro","text":"New paragr',
    );
    expect(draft).not.toBeNull();
    expect(draft?.proposal).toEqual({
      action: "insert_after",
      anchor: "## Intro",
      text: "New paragr",
    });
    expect(draft?.textComplete).toBe(false);
  });

  it("places append and replace_selection without an anchor", () => {
    const draft = draftProposal('{"action":"append","text":"tail');
    expect(draft?.proposal.action).toBe("append");
    expect(draft?.proposal.anchor).toBeUndefined();
  });

  it("places a delete as soon as its anchor is known", () => {
    const draft = draftProposal('{"action":"delete","anchor":"stale line"}');
    expect(draft?.proposal).toEqual({
      action: "delete",
      anchor: "stale line",
      text: "",
    });
  });
});
