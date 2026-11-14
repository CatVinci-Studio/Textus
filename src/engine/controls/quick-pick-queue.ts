/** A list to choose one item from, or several ticked, filtered by what is
 *  typed: the command palette's and a plugin's textus.ui.pick. Requests
 *  queue here; the list itself (quick-pick.tsx) loads with the first. */

export interface QuickPickItem {
  label: string;
  description?: string;
  /** A second line under it. */
  detail?: string;
  /** What the plugin gets back; the label if left out. */
  value?: unknown;
  /** With `multiple`: ticked to start with. */
  picked?: boolean;
  /** A shortcut that does the same, shown at the row's end ("mod+s"). */
  keys?: string;
}

export interface Request {
  id: number;
  items: QuickPickItem[];
  placeholder: string;
  multiple: boolean;
  /** The text in the box to start with; what follows it filters too. */
  query: string;
  /** Enter on text that matches nothing resolves { typed: text }. */
  typed: boolean;
  /** The rows for what is typed, asked as it changes, in place of
   *  filtering `items` here (which show until it answers). */
  search?: (query: string) => Promise<QuickPickItem[]>;
  resolve: (value: unknown) => void;
}

let nextId = 1;
let queue: Request[] = [];

const listeners = new Set<() => void>();

function publish() {
  for (const listener of listeners) listener();
}

export function subscribeQuickPick(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The request showing now, if any. */
export function quickPickNow(): Request | undefined {
  return queue[0];
}

/** Resolves the chosen item's value - with `multiple`, the ticked ones'
 *  values - or null when dismissed. */
export function showQuickPick(
  items: QuickPickItem[],
  placeholder: string,
  options: {
    multiple?: boolean;
    query?: string;
    typed?: boolean;
    search?: Request["search"];
  } = {},
): Promise<unknown> {
  return new Promise((resolve) => {
    queue = [
      ...queue,
      {
        id: nextId++,
        items,
        placeholder,
        multiple: options.multiple === true,
        query: options.query ?? "",
        typed: options.typed === true,
        search: options.search,
        resolve,
      },
    ];
    publish();
  });
}

export function valueOf(item: QuickPickItem): unknown {
  return item.value === undefined ? item.label : item.value;
}

export function answer(request: Request, value: unknown) {
  queue = queue.filter((r) => r.id !== request.id);
  publish();
  request.resolve(value);
}
