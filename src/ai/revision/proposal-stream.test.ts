import { describe, expect, it } from "vitest";
import { ProposalStream, type ProposalStreamEffects } from "./proposal-stream";

type Call =
  | { effect: "place"; callId: string; action: string; text?: string }
  | { effect: "feed"; callId: string; text: string; done: boolean }
  | { effect: "finalize"; callId: string; action: string; text?: string }
  | { effect: "discard"; callId: string };

function machine() {
  const calls: Call[] = [];
  const effects: ProposalStreamEffects = {
    place: (callId, p) =>
      calls.push({ effect: "place", callId, action: p.action, text: p.text }),
    feed: (callId, text, done) =>
      calls.push({ effect: "feed", callId, text, done }),
    finalize: (callId, p) =>
      calls.push({
        effect: "finalize",
        callId,
        action: p.action,
        text: p.text,
      }),
    discard: (callId) => calls.push({ effect: "discard", callId }),
  };
  return { stream: new ProposalStream(effects), calls };
}

describe("ProposalStream", () => {
  it("places once the anchor is complete, then feeds the growing text", () => {
    const { stream, calls } = machine();
    stream.toolStart("c1", "propose_edit");
    stream.argsDelta("c1", '{"action":"replace","anchor":"ol');
    expect(calls).toEqual([]); // anchor still open - not locatable yet
    stream.argsDelta("c1", 'd","text":"new ');
    expect(calls[0]).toMatchObject({ effect: "place", callId: "c1" });
    stream.argsDelta("c1", "words");
    const feeds = calls.filter((c) => c.effect === "feed");
    expect(feeds[feeds.length - 1]).toEqual({
      effect: "feed",
      callId: "c1",
      text: "new words",
      done: false,
    });
  });

  it("takes a call said to start again as the same call", () => {
    const { stream, calls } = machine();
    stream.toolStart("g1", "generate_image");
    stream.argsDelta(
      "g1",
      '{"action":"replace","alt":"","anchor":"![](a.png)","aspect":"16:9","prompt":"x',
    );
    expect(calls[0]).toMatchObject({ effect: "place", callId: "g1" });
    // The backend announces the picture it runs (images.rs' execute).
    stream.toolStart("g1", "generate_image");
    stream.finalCall("g1", "{}");
    expect(calls[calls.length - 1]).toEqual({
      effect: "discard",
      callId: "g1",
    });
  });

  it("discards a completed call the backend refused, and only that", () => {
    const { stream, calls } = machine();
    stream.toolStart("c1", "propose_edit");
    stream.finalCall("c1", '{"action":"append","text":"x"}');
    stream.result("c1", true);
    expect(calls.at(-1)).toEqual({ effect: "discard", callId: "c1" });
    // A result for a call it never saw, or one accepted: nothing.
    const before = calls.length;
    stream.result("other", true);
    stream.toolStart("c2", "propose_edit");
    stream.finalCall("c2", '{"action":"append","text":"y"}');
    stream.result("c2", false);
    expect(calls.slice(before).some((c) => c.effect === "discard")).toBe(false);
  });

  it("ignores tools other than propose_edit", () => {
    const { stream, calls } = machine();
    stream.toolStart("c1", "search_document");
    stream.argsDelta("c1", '{"action":"replace","anchor":"a","text":"b"}');
    expect(calls).toEqual([]);
  });

  it("closes the reveal on the final call, even textless ones", () => {
    const { stream, calls } = machine();
    stream.toolStart("c1", "propose_edit");
    stream.argsDelta("c1", '{"action":"delete","anchor":"gone"');
    stream.finalCall("c1", '{"action":"delete","anchor":"gone"}');
    expect(calls[calls.length - 1]).toEqual({
      effect: "feed",
      callId: "c1",
      text: "",
      done: true,
    });
  });

  it("discards a placed draft whose final arguments don't validate", () => {
    const { stream, calls } = machine();
    stream.toolStart("c1", "propose_edit");
    stream.argsDelta("c1", '{"action":"replace","anchor":"a","text":"b');
    stream.finalCall("c1", '{"action":"replace"}'); // replace without anchor
    expect(calls[calls.length - 1]).toEqual({
      effect: "discard",
      callId: "c1",
    });
  });

  it("stop freezes a placed draft as a decidable proposal", () => {
    const { stream, calls } = machine();
    stream.toolStart("c1", "propose_edit");
    stream.argsDelta(
      "c1",
      '{"action":"replace","anchor":"a","text":"partial wor',
    );
    stream.finish("stopped");
    expect(calls[calls.length - 2]).toEqual({
      effect: "feed",
      callId: "c1",
      text: "partial wor",
      done: true,
    });
    expect(calls[calls.length - 1]).toMatchObject({
      effect: "finalize",
      callId: "c1",
      action: "replace",
      text: "partial wor",
    });
  });

  it("failure discards a placed draft", () => {
    const { stream, calls } = machine();
    stream.toolStart("c1", "propose_edit");
    stream.argsDelta("c1", '{"action":"replace","anchor":"a","text":"b');
    stream.finish("failed");
    expect(calls[calls.length - 1]).toEqual({
      effect: "discard",
      callId: "c1",
    });
  });

  it("ending never surfaces a draft that was never placed", () => {
    const { stream, calls } = machine();
    stream.toolStart("c1", "propose_edit");
    stream.argsDelta("c1", '{"action":"repl'); // action not even complete
    stream.finish("stopped");
    expect(calls).toEqual([]);
  });

  it("finish after a completed call is a no-op", () => {
    const { stream, calls } = machine();
    stream.toolStart("c1", "propose_edit");
    stream.argsDelta("c1", '{"action":"append","text":"done"}');
    stream.finalCall("c1", '{"action":"append","text":"done"}');
    const before = calls.length;
    stream.finish("stopped");
    expect(calls.length).toBe(before);
  });
});
