import { history } from "@milkdown/kit/prose/history";
import { type Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import {
  EditorState,
  type Plugin,
  TextSelection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { Step, StepMap } from "@milkdown/kit/prose/transform";

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
}

/** prosemirror-history's plugin, known by its config (its key is private). */
function isHistory(plugin: Plugin): boolean {
  const { config } = plugin.spec as { config?: { newGroupDelay?: unknown } };
  return config?.newGroupDelay !== undefined;
}

const historyOf = (state: EditorState) => {
  const plugin = state.plugins.find(isHistory);
  const at = plugin?.getState(state) as HistoryState | undefined;
  return plugin && at ? { plugin, at } : null;
};

const leave = (branch: Branch<Item>): LeftBranch => {
  const items: LeftItem[] = [];
  branch.items.forEach((item) =>
    items.push({ ...item, step: item.step?.toJSON() }),
  );
  return { items, eventCount: branch.eventCount };
};

/** `state`'s undo and redo history, to keep past its editor; null with none. */
export function leaveHistory(state: EditorState): LeftHistory | null {
  const at = historyOf(state)?.at;
  if (!at || at.done.eventCount + at.undone.eventCount === 0) return null;
  return {
    done: leave(at.done),
    undone: leave(at.undone),
    prevRanges: at.prevRanges,
  };
}

// The library's item class, taken off an edit made in a scrap editor.
let itemClass: Class<Item> | null = null;
function anItem(): Class<Item> {
  if (itemClass) return itemClass;
  const schema = new Schema({ nodes: { doc: { content: "text*" }, text: {} } });
  const scrap = EditorState.create({ schema, plugins: [history()] });
  const edited = scrap.apply(scrap.tr.insertText("a"));
  historyOf(edited)!.at.done.items.forEach(
    (item) => (itemClass ??= item.constructor as Class<Item>),
  );
  return itemClass!;
}

/** `left` as a history state of the library's, on an empty one's classes. */
function enter(left: LeftHistory, fresh: HistoryState, schema: Schema) {
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
  const Item = anItem() as unknown as new (
    map: StepMap,
    step: Step | undefined,
    selection: unknown,
    mirrorOffset: number | undefined,
  ) => Item;
  const branch = (from: LeftBranch) =>
    new Branch(
      fresh.undone.items.append(
        from.items.map(
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
      from.eventCount,
    );
  // Its last edit is closed: the next key starts a step of its own.
  return new State(
    branch(left.done),
    branch(left.undone),
    left.prevRanges,
    0,
    -1,
  );
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
    try {
      return enter(left, fresh, instance.schema);
    } catch {
      return fresh;
    }
  };
  return plugin;
}

/** The transaction that gives `state`, its history still empty, `left` as
 *  its history: nothing in the document changes. Null when it can't. */
export function takeHistory(
  state: EditorState,
  left: LeftHistory,
): Transaction | null {
  const found = historyOf(state);
  if (!found || found.at.done.eventCount + found.at.undone.eventCount > 0)
    return null;
  try {
    const historyState = enter(left, found.at, state.schema);
    return state.tr
      .setMeta(found.plugin.spec.key!, { historyState })
      .setMeta("addToHistory", false);
  } catch {
    return null;
  }
}

/** A selection bookmark as the file keeps it. */
const point = (anchor: number, head: number) => ({
  anchor,
  head,
  map: (mapping: { map(pos: number): number }) =>
    point(mapping.map(anchor), mapping.map(head)),
  resolve(doc: ProseNode) {
    const at = (pos: number) =>
      doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
    return TextSelection.between(at(anchor), at(head));
  },
});

/** `left` as text for a file. */
export function writeHistory(left: LeftHistory): string {
  const branch = (from: LeftBranch) => ({
    eventCount: from.eventCount,
    items: from.items.map((item) => {
      const map = item.map as unknown as {
        ranges: number[];
        inverted: boolean;
      };
      const at = item.selection as
        { anchor?: number; head?: number } | undefined;
      return {
        map: [map.ranges, map.inverted],
        step: item.step,
        selection: at && [at.anchor ?? 0, at.head ?? at.anchor ?? 0],
        mirrorOffset: item.mirrorOffset,
      };
    }),
  });
  return JSON.stringify({
    format: FORMAT,
    done: branch(left.done),
    undone: branch(left.undone),
    prevRanges: left.prevRanges,
  });
}

const FORMAT = 2;

/** The history a file's text holds; null when it isn't one of these. */
export function readHistory(text: string): LeftHistory | null {
  try {
    const kept = JSON.parse(text) as {
      format?: number;
      done: FileBranch;
      undone: FileBranch;
      prevRanges: number[] | null;
    };
    if (kept.format !== FORMAT) return null;
    const branch = (from: FileBranch): LeftBranch => ({
      eventCount: from.eventCount,
      items: from.items.map((item) => ({
        map: new StepMap(item.map[0], item.map[1]),
        step: item.step ?? undefined,
        selection: item.selection
          ? point(item.selection[0], item.selection[1])
          : undefined,
        mirrorOffset: item.mirrorOffset ?? undefined,
      })),
    });
    return {
      done: branch(kept.done),
      undone: branch(kept.undone),
      prevRanges: kept.prevRanges,
    };
  } catch {
    return null;
  }
}
interface FileBranch {
  eventCount: number;
  items: {
    map: [number[], boolean];
    step?: unknown;
    selection?: [number, number] | null;
    mirrorOffset?: number | null;
  }[];
}
