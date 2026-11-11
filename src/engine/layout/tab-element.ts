import { tabInUse } from "./store";

/** The element drawing tab `id` in the window's islands - the tab in use by
 *  default, as the window's model says: what code reaches into a tab by,
 *  never by which element is marked active. */
export function tabElement(id: string = tabInUse()): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.main-pane [data-tab-id=${JSON.stringify(id)}]`,
  );
}
