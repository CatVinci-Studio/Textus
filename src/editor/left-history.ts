import { history } from "@milkdown/kit/prose/history";
import type { Schema } from "@milkdown/kit/prose/model";
import type { EditorState, Plugin } from "@milkdown/kit/prose/state";
import { Step, type StepMap } from "@milkdown/kit/prose/transform";

// An editor's undo and redo history taken out as plain data when the editor
// goes, and given to the next editor of the same document as its starting
// state: no step is applied again, so nothing else in the editor sees an
// edit. The shapes are prosemirror-history's own (1.5).

interface Item {
  map: StepMap;
  step?: Step;
  selection?: unknown;
  mirrorOffset?: number;
}
interface Rope<T> {
  forEach(f: (item: T) => void): void;
  append(items: T[]): Rope<T>;
}
interface Branch<T> {
  items: Rope<T>;
  eventCount: number;
}
interface HistoryState {
  done: Branch<Item>;
  undone: Branch<Item>;
  prevRanges: readonly number[] | null;
  prevTime: number;
  prevComposition: number;
}
type Class<T> = new (...args: never[]) => T;

/** An item with its step written out, held by no schema. */
type LeftItem = Omit<Item, "step"> & { step?: unknown };
interface LeftBranch {
  items: LeftItem[];
  eventCount: number;
}
/** A history out of its editor. */
export interface LeftHistory {
  done: LeftBranch;
  undone: LeftBranch;
  prevRanges: readonly number[] | null;
  make: Class<Item>;
}

/** prosemirror-history's plugin, known by its config (its key is private). */
export function isHistory(plugin: Plugin): boolean {
  const { config } = plugin.spec as { config?: { newGroupDelay?: unknown } };
  return config?.newGroupDelay !== undefined;
}

const leave = (branch: Branch<Item>): LeftBranch => {
  const items: LeftItem[] = [];
  branch.items.forEach((item) =>
    items.push({ ...item, step: item.step?.toJSON() }),
  );
  return { items, eventCount: branch.eventCount };
};

/** `state`'s undo and redo history, to keep past its editor; null with none. */
export function leaveHistory(state: EditorState): LeftHistory | null {
  const plugin = state.plugins.find(isHistory);
  const at = plugin?.getState(state) as HistoryState | undefined;
  if (!at || at.done.eventCount + at.undone.eventCount === 0) return null;
  let make: Class<Item> | null = null;
  for (const branch of [at.done, at.undone])
    branch.items.forEach((item) => (make ??= item.constructor as Class<Item>));
  if (!make) return null;
  return {
    done: leave(at.done),
    undone: leave(at.undone),
    prevRanges: at.prevRanges,
    make,
  };
}

/** The history plugin, starting from `left` where there is one. */
export function historyFrom(
  config: Parameters<typeof history>[0],
  left: LeftHistory | null,
): Plugin {
  const plugin = history(config);
  const field = plugin.spec.state;
  if (!left || !field) return plugin;
  const init = field.init;
  field.init = function (stateConfig, instance) {
    const fresh = init.call(this, stateConfig, instance) as HistoryState;
    const Branch = fresh.done.constructor as new (
      items: Rope<Item>,
      eventCount: number,
    ) => Branch<Item>;
    const State = fresh.constructor as new (
      done: Branch<Item>,
      undone: Branch<Item>,
      prevRanges: readonly number[] | null,
      prevTime: number,
      prevComposition: number,
    ) => HistoryState;
    const Item = left.make as unknown as new (
      map: StepMap,
      step: Step | undefined,
      selection: unknown,
      mirrorOffset: number | undefined,
    ) => Item;
    const enter = (branch: LeftBranch, schema: Schema) =>
      new Branch(
        fresh.done.items.append(
          branch.items.map(
            (item) =>
              new Item(
                item.map,
                item.step === undefined
                  ? undefined
                  : Step.fromJSON(schema, item.step),
                item.selection,
                item.mirrorOffset,
              ),
          ),
        ),
        branch.eventCount,
      );
    try {
      // Its last edit is closed: the next key starts a step of its own.
      return new State(
        enter(left.done, instance.schema),
        enter(left.undone, instance.schema),
        left.prevRanges,
        0,
        -1,
      );
    } catch {
      return fresh;
    }
  };
  return plugin;
}
