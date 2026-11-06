import { plugins as pluginsIpc } from "../../platform/ipc";
import { dirname } from "../../utils/path";
import { withResources } from "../store/files";
import { written } from "./broker-files";
import {
  postToWebview,
  setWebviewHtml,
  setWebviewTitle,
} from "../views/webviews";
import {
  listRefreshed,
  registerListView,
  setListMessage,
  unregisterListView,
} from "../contributions/list-views";
import { setCodeBlockSource } from "../contributions/code-blocks";
import {
  embedRefreshed,
  forgetEmbed,
  setPluginEmbed,
} from "../contributions/embeds";
import {
  optionalStr,
  str,
  type Params,
  type PluginScope,
} from "./broker-scope";

let nextEmbedAsk = 1;

/**
 * A plugin's calls about what it shows: a webview's page, title and messages,
 * a file editor's file, its list views, a drawn code block's source.
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
        await withResources(str(html, "html"), p.id, p.readOwnFile),
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
    "views.registerEmbed": ({ id }: Params) => {
      const name = str(id, "id");
      const declared = p
        .manifest()
        .contributes.embeds.find((e) => e.id === name);
      if (!declared) throw new Error(`No embed ${name} in the manifest.`);
      setPluginEmbed(p.id, name, declared.targets, (target, signal) => {
        const request = nextEmbedAsk++;
        signal.addEventListener(
          "abort",
          () => void p.request("$cancelEmbed", { request }).catch(() => {}),
          { once: true },
        );
        return p.request("$provideEmbed", { id: name, target, request });
      });
    },
    "views.unregisterEmbed": ({ id }: Params) => {
      forgetEmbed(p.id, str(id, "id"));
    },
    "views.embedRefresh": () => {
      embedRefreshed(p.id);
    },
    "codeBlock.setSource": ({ webview: id, source }: Params) => {
      const record = p.ownWebview(str(id, "webview"));
      return setCodeBlockSource(record.id, str(source, "source"));
    },
  };
}
