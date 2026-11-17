/** A list to choose one item from, or several ticked, filtered by what is
 *  typed: the command palette's and a plugin's textus.ui.pick. Requests
 *  queue here; the list itself (quick-pick.tsx) loads with the first. */

import { createRequestQueue } from "../../utils/store";

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

const queue = createRequestQueue<Request>();

export const subscribeQuickPick = queue.subscribe;

/** The request showing now, if any. */
export const quickPickNow = queue.now;

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
  return new Promise((resolve) =>
    queue.add((id) => ({
      id,
      items,
      placeholder,
      multiple: options.multiple === true,
      query: options.query ?? "",
      typed: options.typed === true,
      search: options.search,
      resolve,
    })),
  );
}

export function valueOf(item: QuickPickItem): unknown {
  return item.value === undefined ? item.label : item.value;
}

export function answer(request: Request, value: unknown) {
  queue.remove(request.id);
  request.resolve(value);
}
