import { describe, expect, it } from "vitest";
import { setOpenFolder } from "../platform/open-folder";
import type { FileStep } from "./file-undo";
import { fileUndoStack, windowFileUndo, type StepRun } from "./file-undo-stack";

const step = (path: string): FileStep => ({
  kind: "made",
  made: [{ path, isDir: false, stamp: "1" }],
});

const pathOf = (s: FileStep) => (s.kind === "made" ? s.made[0]!.path : "");

/** A run that writes down what it ran and does each again as `path!`. */
function recorder(outcome: (s: FileStep) => StepRun | null = () => null) {
  const ran: string[] = [];
  const run = async (s: FileStep): Promise<StepRun> => {
    ran.push(pathOf(s));
    return outcome(s) ?? { done: true, again: step(`${pathOf(s)}!`) };
  };
  return { ran, run };
}

describe("the tree's undo stack", () => {
  it("takes the newest first, each once; an older notice's Undo does nothing", async () => {
    const stack = fileUndoStack();
    const first = step("/n/a.md");
    const second = step("/n/b.md");
    stack.push(first);
    stack.push(second);
    const { ran, run } = recorder();
    expect(stack.undo(run, first)).toBe(false);
    expect(stack.undo(run, second)).toBe(true);
    stack.undo(run, second);
    stack.undo(run);
    await stack.settled();
    expect(ran).toEqual(["/n/b.md", "/n/a.md"]);
    expect(stack.undo(run)).toBe(false);
  });

  it("keeps the last fifty", async () => {
    const stack = fileUndoStack();
    for (let i = 0; i < 60; i++) stack.push(step(`/n/${i}.md`));
    expect(stack.size).toBe(50);
    const { ran, run } = recorder();
    stack.undo(run);
    await stack.settled();
    expect(ran).toEqual(["/n/59.md"]);
  });

  it("runs a held key's undos one after another, never two at once", async () => {
    const stack = fileUndoStack();
    for (const p of ["/n/a.md", "/n/b.md", "/n/c.md"]) stack.push(step(p));
    let running = 0;
    let most = 0;
    const run = async (): Promise<StepRun> => {
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return { done: true, again: null };
    };
    stack.undo(run);
    stack.undo(run);
    stack.undo(run);
    await stack.settled();
    expect(most).toBe(1);
    expect(stack.size).toBe(0);
  });

  it("keeps a refused step where it was, dropping what was asked after it", async () => {
    const stack = fileUndoStack();
    stack.push(step("/n/a.md"));
    stack.push(step("/n/b.md"));
    const { ran, run } = recorder(() => ({ done: false }));
    stack.undo(run);
    stack.undo(run);
    await stack.settled();
    expect(ran).toEqual(["/n/b.md"]);
    expect(stack.size).toBe(2);
    const again = recorder();
    stack.undo(again.run);
    await stack.settled();
    expect(again.ran).toEqual(["/n/b.md"]);
  });

  it("redoes what was undone until something new is done", async () => {
    const stack = fileUndoStack();
    stack.push(step("/n/a.md"));
    const { ran, run } = recorder();
    stack.undo(run);
    await stack.settled();
    stack.redo(run);
    await stack.settled();
    expect(ran).toEqual(["/n/a.md", "/n/a.md!"]);
    stack.undo(run);
    await stack.settled();
    stack.push(step("/n/new.md"));
    expect(stack.redo(run)).toBe(false);
  });

  it("leaves no Redo from an undo that finishes after something new was done", async () => {
    const stack = fileUndoStack();
    stack.push(step("/n/a.md"));
    let finish = () => {};
    const slow = (): Promise<StepRun> =>
      new Promise((resolve) => {
        finish = () => resolve({ done: true, again: step("/n/a.md!") });
      });
    stack.undo(slow);
    await Promise.resolve();
    await Promise.resolve();
    stack.push(step("/n/new.md"));
    finish();
    await stack.settled();
    expect(stack.redo(recorder().run)).toBe(false);
    expect(stack.size).toBe(1);
  });

  it("is the window's, emptied only when another folder opens or it closes", () => {
    windowFileUndo.push(step("/p/a.md"));
    setOpenFolder("/p");
    expect(windowFileUndo.size).toBe(0);
    windowFileUndo.push(step("/p/a.md"));
    setOpenFolder("/p");
    expect(windowFileUndo.size).toBe(1);
    setOpenFolder(null);
    expect(windowFileUndo.size).toBe(0);
  });
});
