// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parserCtx, serializerCtx } from "@milkdown/kit/core";
import { closeViews, openView } from "../../editor/editor-view-kit";
import { keptOriginal } from "./useOwnRevisions";

const SHOWN = "The harbour was quiet at dawn.\n";

describe("keptOriginal", () => {
  it("carries on from the original when the editor shows the revised text", () => {
    const text = JSON.stringify({ base: "silent", revised: SHOWN });
    expect(keptOriginal(text, SHOWN)).toBe("silent");
  });

  it("carries on from an original kept from before 1.3, with no revised text", () => {
    expect(keptOriginal(JSON.stringify({ base: "silent" }), SHOWN)).toBe(
      "silent",
    );
  });

  it("gives way when the file no longer holds what was revised", () => {
    const text = JSON.stringify({ base: "empty", revised: "still" });
    expect(keptOriginal(text, SHOWN)).toBeNull();
  });

  it("has nothing for no file, a broken one, or one without an original", () => {
    expect(keptOriginal(null, SHOWN)).toBeNull();
    expect(keptOriginal("{", SHOWN)).toBeNull();
    expect(keptOriginal("{}", SHOWN)).toBeNull();
  });

  it("carries on when the file's text is written its own way (a table, __bold__)", async () => {
    // As the tab saved it, which keeps the writer's own spelling.
    const revised = "| a |b|\n|---|---|\n| 1 |2|\n\n__bold__\n";
    const { editor, view } = await openView(revised);
    const [shown, same] = editor.action((ctx) => {
      const serialize = ctx.get(serializerCtx);
      const parse = ctx.get(parserCtx);
      return [
        serialize(view.state.doc),
        (md: string) => serialize(parse(md)),
      ] as const;
    });
    expect(shown).not.toBe(revised);
    const text = JSON.stringify({ base: "original", revised });
    expect(keptOriginal(text, shown, same)).toBe("original");
    await closeViews();
  });
});
