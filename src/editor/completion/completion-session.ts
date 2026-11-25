import { pinyinEngine } from "../../utils/pinyin";
import { CompletionPanel } from "./completion-panel";
import {
  preparePinyin,
  prepareList,
  type PreparedList,
} from "../../utils/list-filter";
import {
  appendLate,
  firstItem,
  matchSources,
  nextItem,
  panelRows,
  type Group,
  type PanelRow,
  type SourceMatch,
} from "./panel-rows";
import type {
  CompletionAnswer,
  CompletionContext,
  CompletionPlace,
  CompletionSource,
  PanelItem,
} from "./sources";

/** The most text either side of the caret a source is shown. */
export const CONTEXT_CHARS = 200;
/** An answer later than this is dropped, and its group shows nothing. */
const ANSWER_MS = 3000;
/** A list the provider filtered; a whole list the panel filters itself. */
const MAX_ITEMS = 50;
const MAX_LIST = 20_000;
/** "…" alone waits this long, so a quick answer or an "@" in an address
 *  doesn't flash an empty panel. */
const LOADING_SHOWN_MS = 80;

/** What is around the caret, in its block or line. */
export interface CaretContext {
  /** Before the caret, at most a few hundred characters. */
  text: string;
  /** After it, to the end of its block, as far. */
  after: string;
  inMath: boolean;
  /** In a code block: its language, "" for none. */
  language?: string;
  /** The caret's position in the editor's own terms. */
  caret: number;
}

/** What the panel needs of the editor it completes in: the rich editor and
 *  source mode are both one. */
export interface CompletionHost {
  /** Around the caret; null where nothing is typed (code, a selection
   *  across blocks). */
  context(): CaretContext | null;
  /** The document's path; null for an unsaved one. */
  path(): string | null;
  /** The sources it offers. */
  sources(): readonly CompletionSource[];
  /** `insert` put in over `from`-`to`, the caret at its `$0`: its own undo
   *  step. */
  insert(insert: string, from: number, to: number): void;
  coords(pos: number): { left: number; top: number; bottom: number };
  focus(): void;
}

const placeOf = (context: CaretContext): CompletionPlace =>
  context.language !== undefined ? "code" : context.inMath ? "math" : "text";

/** Sources seen answering a list they filter themselves: asked again on
 *  every key, the ask before called off. */
const filtersItself = new Set<string>();

/** Each whole list prepared once, however often its source hands it over. */
const prepared = new WeakMap<readonly PanelItem[], PreparedList<PanelItem>>();

function prepareOnce(items: PanelItem[]): PreparedList<PanelItem> {
  let list = prepared.get(items);
  if (!list)
    prepared.set(items, (list = prepareList(items.slice(0, MAX_LIST))));
  return list;
}

/** Only what an item may hold, from whatever a source answered. */
function cleanItems(value: unknown, max: number): PanelItem[] {
  if (!Array.isArray(value)) return [];
  const out: PanelItem[] = [];
  for (const v of value as PanelItem[]) {
    if (out.length >= max) break;
    if (v && typeof v.label === "string" && typeof v.insert === "string")
      out.push(v);
  }
  return out;
}

interface LiveGroup extends Group {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  /** The match it was asked for: a list it filters itself is for that. */
  asked: string;
  context: Omit<CompletionContext, "match" | "query">;
}

export interface CompletionSession {
  /** A key while the panel may want it; true when it took it. */
  key(key: string): boolean;
  /** Matches what is before the caret again; true when anything matched. */
  refresh(): boolean;
  /** The editor changed: its text, or only where the caret is. */
  changed(docChanged: boolean): void;
  destroy(): void;
}

/**
 * The `/` panel as you type: every source whose pattern matches before the
 * caret - `/` commands, emoji, notes, each plugin's completions - in one
 * panel, grouped. It opens in the keystroke's frame with what is known;
 * the sources still answering are asked at once and come in as they do,
 * never holding up typing or moving the row the user chose.
 */
export function completionSession(host: CompletionHost): CompletionSession {
  const panel = new CompletionPanel();
  let groups = new Map<string, LiveGroup>();
  let order: SourceMatch[] = [];
  let rows: PanelRow[] = [];
  let chosen = -1;
  /** An arrow was pressed: late groups go under the rows. */
  let arrowed = false;
  /** An item was just written: its own text doesn't open the list again;
   *  the next thing typed may. */
  let took = false;
  let loadingTimer: ReturnType<typeof setTimeout> | null = null;
  let pinyinTimer: ReturnType<typeof setTimeout> | null = null;

  const stop = (group: LiveGroup) => {
    group.controller.abort();
    if (group.timer) clearTimeout(group.timer);
  };
  const close = () => {
    groups.forEach(stop);
    groups = new Map();
    order = [];
    rows = [];
    chosen = -1;
    arrowed = false;
    if (loadingTimer) clearTimeout(loadingTimer);
    loadingTimer = null;
    panel.hide();
  };
  const take = (index: number) => {
    const row = rows[index];
    if (row?.kind !== "item") return;
    const { item, group } = row;
    const context = host.context();
    const caret = context?.caret ?? group.from + group.match.match.length;
    const room = context?.after.length ?? 0;
    const to = caret + Math.min(Math.max(0, item.replaceAfter ?? 0), room);
    close();
    took = true;
    host.insert(item.insert, group.from, to);
    host.focus();
    item.run?.();
  };
  const anchor = () => {
    const first = groups.get(order[0]?.source.id ?? "");
    try {
      return host.coords(first?.from ?? host.context()?.caret ?? 0);
    } catch {
      // No layout to measure (a hidden tab).
      return { left: 0, top: 0, bottom: 0 };
    }
  };
  const draw = () => {
    if (!rows.length) return close();
    const onlyLoading = rows.length === 1 && rows[0].kind === "loading";
    if (onlyLoading && !panel.isOpen()) {
      loadingTimer ??= setTimeout(() => {
        loadingTimer = null;
        if (rows.length) panel.show(rows, chosen, anchor, take);
      }, LOADING_SHOWN_MS);
      return;
    }
    panel.show(rows, chosen, anchor, take);
  };
  const ordered = () => order.flatMap((m) => groups.get(m.source.id) ?? []);
  const relayout = () => {
    rows = panelRows(ordered());
    chosen = firstItem(rows);
    draw();
  };
  /** Pinyin keys for the whole lists, a slice at a time between
   *  keystrokes; the rows again once they're all there. */
  const preparePinyinSoon = () => {
    if (pinyinTimer) return;
    if (!pinyinEngine.peek()) {
      void pinyinEngine.load().then(preparePinyinSoon, () => {});
      return;
    }
    pinyinTimer = setTimeout(() => {
      pinyinTimer = null;
      let done = true;
      for (const group of groups.values())
        if (group.list && !preparePinyin(group.list, performance.now() + 4))
          done = false;
      if (!done) preparePinyinSoon();
      else if (groups.size && !arrowed) relayout();
    }, 0);
  };
  const answered = (group: LiveGroup, answer: CompletionAnswer) => {
    group.pending = false;
    if (group.timer) clearTimeout(group.timer);
    if (answer && !Array.isArray(answer) && answer.complete === true) {
      filtersItself.delete(group.match.source.id);
      group.list = prepareOnce(answer.items);
      if (group.list.pinyin.length < group.list.items.length)
        preparePinyinSoon();
    } else {
      if (answer) filtersItself.add(group.match.source.id);
      group.items = cleanItems(answer, MAX_ITEMS);
    }
  };
  const ask = (
    match: SourceMatch,
    from: number,
    context: Omit<CompletionContext, "match" | "query">,
  ): LiveGroup => {
    const controller = new AbortController();
    const group: LiveGroup = {
      match,
      pending: true,
      list: null,
      items: [],
      from,
      controller,
      timer: null,
      asked: match.match,
      context,
    };
    let answer: CompletionAnswer | Promise<CompletionAnswer>;
    try {
      answer = match.source.provide(
        { ...context, match: match.match, query: match.query },
        controller.signal,
      );
    } catch {
      answer = null;
    }
    if (!(answer instanceof Promise)) {
      answered(group, answer);
      return group;
    }
    group.timer = setTimeout(() => {
      controller.abort();
      late(group, null);
    }, ANSWER_MS);
    answer.then(
      (value) => late(group, value),
      () => late(group, null),
    );
    return group;
  };
  /** An answer after the keystroke: shown if still wanted. */
  const late = (group: LiveGroup, answer: CompletionAnswer) => {
    if (!group.pending || groups.get(group.match.source.id) !== group) return;
    if (answer === null) group.controller.abort();
    // A list for what was typed before: ask for what is typed now.
    if (Array.isArray(answer) && group.match.match !== group.asked) {
      const again = ask(group.match, group.from, group.context);
      groups.set(group.match.source.id, again);
      if (!again.pending) relayout();
      return;
    }
    answered(group, answer);
    if (arrowed && panel.isOpen()) {
      rows = appendLate(rows, group);
      draw();
    } else relayout();
  };
  const refresh = (): boolean => {
    const sources = host.sources();
    const context = sources.length ? host.context() : null;
    const matches = context
      ? matchSources(sources, context.text, placeOf(context))
      : [];
    if (!context || !matches.length) {
      close();
      return false;
    }
    const next = new Map<string, LiveGroup>();
    const base = {
      text: context.text,
      after: context.after,
      inMath: context.inMath,
      ...(context.language === undefined ? {} : { language: context.language }),
      path: host.path(),
    };
    for (const match of matches) {
      const from = context.caret - match.match.length;
      const prev = groups.get(match.source.id);
      // A whole list goes on being filtered while its match grows from the
      // same place; anything else is asked again.
      if (
        prev &&
        prev.from === from &&
        (prev.list || (prev.pending && !filtersItself.has(match.source.id))) &&
        match.match.startsWith(prev.match.match)
      ) {
        prev.match = match;
        prev.context = base;
        next.set(match.source.id, prev);
        continue;
      }
      if (prev) stop(prev);
      const group = ask(match, from, base);
      // Its rows stay while it answers again, so nothing jumps.
      if (prev && group.pending && prev.from === from) group.items = prev.items;
      next.set(match.source.id, group);
    }
    for (const [id, group] of groups) if (!next.has(id)) stop(group);
    groups = next;
    order = matches;
    arrowed = false;
    relayout();
    return true;
  };

  return {
    key(key) {
      if (!panel.isOpen() || chosen < 0) {
        if (key === "Escape" && groups.size) {
          close();
          return true;
        }
        return false;
      }
      if (key === "Escape") close();
      else if (key === "ArrowDown" || key === "ArrowUp") {
        arrowed = true;
        chosen = nextItem(rows, chosen, key === "ArrowDown" ? 1 : -1);
        panel.choose(chosen);
      } else if (key === "Enter" || key === "Tab") take(chosen);
      else return false;
      return true;
    },
    refresh,
    changed(docChanged) {
      if (docChanged) {
        if (took) took = false;
        else refresh();
        return;
      }
      if (!groups.size) return;
      // The caret moved: it stays open only inside the same match.
      const anchorAt = groups.get(order[0]?.source.id ?? "")?.from;
      if (!refresh() || groups.get(order[0].source.id)?.from !== anchorAt)
        close();
    },
    destroy() {
      close();
      if (pinyinTimer) clearTimeout(pinyinTimer);
      panel.destroy();
    },
  };
}
