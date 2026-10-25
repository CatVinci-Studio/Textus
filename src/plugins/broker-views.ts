import { plugins as pluginsIpc } from "../platform/ipc";
import { dirname } from "../utils/path";
import { withResources } from "./files";
import { written } from "./broker-files";
import { postToWebview, setWebviewHtml, setWebviewTitle } from "./webviews";
import {
  listRefreshed,
  registerListView,
  setListMessage,
  unregisterListView,
} from "./list-views";
import { setCodeBlockSource } from "./code-blocks";
import {
  optionalStr,
  str,
  type Params,
  type PluginScope,
} from "./broker-scope";

/**
 * A plugin's calls about what it shows (textus.views and its webviews):
 * a webview's page, title and messages, the file a file editor shows, its
 * list views, the source of a code block it draws.
 */
export function viewHandlers(p: PluginScope) {
  const listOf = (view: unknown) => {
    const id = str(view, "view");
    const m = p.manifest().contributes;
    const declared = [...m.views, ...m.sidebarTabs].find((v) => v.id === id);
    if (!declared || declared.type !== "list")
      throw new Error(`No list ${id} in the manifest.`);
    return id;
  };
  return {
    "webview.setHtml": async ({ webview: id, html }: Params) => {
      const record = p.ownWebview(str(id, "webview"));
      setWebviewHtml(
        record.id,
        await withResources(str(html, "html"), p.readOwnFile),
      );
    },
    "webview.postMessage": ({ webview: id, message }: Params) => {
      const record = p.ownWebview(str(id, "webview"));
      postToWebview(record.id, message);
      return true;
    },
    "webview.setTitle": ({ webview: id, title }: Params) => {
      const record = p.ownWebview(str(id, "webview"));
      setWebviewTitle(record.id, str(title, "title"));
    },
    "webview.readFile": ({ webview: id }: Params) => {
      const record = p.ownWebview(str(id, "webview"));
      if (!record.resource) throw new Error("This view shows no file.");
      return pluginsIpc.readResource(p.id, record.resource);
    },
    "webview.writeFile": ({ webview: id, text }: Params) => {
      p.need("files.write");
      const record = p.ownWebview(str(id, "webview"));
      if (!record.resource) throw new Error("This view shows no file.");
      return written(
        record.resource,
        pluginsIpc.fsWrite(
          p.id,
          dirname(record.resource),
          record.resource,
          str(text, "text"),
        ),
      );
    },
    "views.registerList": ({
      view,
      select,
      check,
      filterPlaceholder,
      emptyText,
    }: Params) => {
      registerListView(p.id, listOf(view), {
        select: select === true,
        check: check === true,
        filterPlaceholder: optionalStr(filterPlaceholder),
        emptyText: optionalStr(emptyText),
      });
    },
    "views.unregisterList": ({ view }: Params) => {
      unregisterListView(p.id, listOf(view));
    },
    "views.listRefresh": ({ view }: Params) => {
      listRefreshed(p.id, listOf(view));
    },
    "views.listMessage": ({ view, text }: Params) => {
      setListMessage(p.id, listOf(view), optionalStr(text) ?? "");
    },
    "codeBlock.setSource": ({ webview: id, source }: Params) => {
      p.need("editor.write");
      const record = p.ownWebview(str(id, "webview"));
      return setCodeBlockSource(record.id, str(source, "source"));
    },
  };
}
