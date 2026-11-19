import {
  optionalStr,
  str,
  type Params,
  type PluginScope,
} from "./broker-scope";

/**
 * `textus.views.registerDatabaseView`: another way to show a database's
 * rows (a timeline, a gallery) that the plugin drawing databases offers
 * beside its own. The rows go to the view's plugin, which answers a page
 * of HTML; scripts and handlers are taken out before the database's page
 * shows it.
 */

interface DatabaseView {
  plugin: string;
  label: string;
  icon: string | null;
  render(data: unknown): Promise<unknown>;
}

/** By `<plugin id>#<view id>`. */
const views = new Map<string, DatabaseView>();

/** How long a view may take to draw its rows. */
const RENDER_WAIT_MS = 5000;

/** Takes a stopped plugin's database views away. */
export function stopPluginDatabaseViews(plugin: string): void {
  for (const [key, view] of views)
    if (view.plugin === plugin) views.delete(key);
}

async function cleanHtml(html: string): Promise<string> {
  const { default: DOMPurify } = await import("dompurify");
  return DOMPurify.sanitize(html, { FORBID_TAGS: ["style"] });
}

export function databaseViewHandlers(p: PluginScope) {
  return {
    "views.registerDatabaseView": ({ id, label, icon }: Params) => {
      const own = str(id, "id");
      views.set(`${p.id}#${own}`, {
        plugin: p.id,
        label: optionalStr(label) ?? own,
        icon: optionalStr(icon) ?? null,
        render: (data) => p.request("$databaseView", { id: own, data }),
      });
    },
    "views.unregisterDatabaseView": ({ id }: Params) => {
      views.delete(`${p.id}#${str(id, "id")}`);
    },
    "views.databaseViews": () =>
      [...views].map(([id, view]) => ({
        id,
        label: view.label,
        icon: view.icon,
        plugin: view.plugin,
      })),
    "views.renderDatabaseView": async ({ id, data }: Params) => {
      const view = views.get(str(id, "id"));
      if (!view) throw new Error(`No database view ${String(id)}.`);
      const html = await Promise.race([
        view.render(data),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`${view.label} took too long.`)),
            RENDER_WAIT_MS,
          ),
        ),
      ]);
      if (typeof html !== "string")
        throw new Error(`${view.label} drew nothing.`);
      return cleanHtml(html);
    },
  };
}
