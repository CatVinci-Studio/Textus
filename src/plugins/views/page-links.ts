import { links } from "../../platform/ipc";

/** A plugin page's web link, clicked: opened in the browser, as the page
 *  itself never leaves for it. */
export function openPageLink({ url }: { url: unknown }): Promise<void> | void {
  const address = String(url ?? "");
  if (/^https?:\/\//i.test(address)) return links.openWebLink(address);
}
