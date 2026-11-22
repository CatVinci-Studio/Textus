// The plugin host's runtime, last part: background code's limits, what the
// window asks of the plugin, and the start.

// Background code has no editor, UI or layout to reach.
if (window.__textusBackground)
  [
    "editor",
    "ui",
    "layout",
    "views",
    "commands",
    "metadata",
    "export",
    "uri",
    "ai",
    "plugins",
    "appearance",
  ].forEach(function (name) {
    textus[name] = new Proxy(
      {},
      {
        get: function () {
          throw new Error(
            "textus." + name + " is not available in background code.",
          );
        },
      },
    );
  });

// ---------------------------------------------------------------
// What the window asks of the plugin
// ---------------------------------------------------------------

/** A list item as it crosses to the window. */
function listItem(item) {
  return plain(item);
}

var handlers = {
  $ping: function () {
    return "pong";
  },
  $activate: async function () {
    var activate = module.exports && module.exports.activate;
    context = makeContext();
    if (!activate) return [];
    var api = await activate(context);
    exported = api && typeof api === "object" ? api : null;
    return exported
      ? Object.keys(exported).filter(function (name) {
          return typeof exported[name] === "function";
        })
      : [];
  },
  $deactivate: function () {
    var deactivate = module.exports && module.exports.deactivate;
    if (context)
      context.subscriptions.splice(0).forEach(function (item) {
        try {
          item.dispose();
        } catch (err) {
          console.error(err);
        }
      });
    return deactivate ? deactivate() : undefined;
  },
  $callExport: async function (params) {
    var fn = exported && exported[params.name];
    if (typeof fn !== "function")
      throw new Error("The plugin exports no " + params.name + ".");
    return plain(await fn.apply(exported, params.args || []));
  },
  $executeCommand: function (params) {
    var run = commands.get(params.command);
    if (!run) throw new Error("No command " + params.command);
    return Promise.resolve(run.apply(null, params.args || [])).then(plain);
  },
  $listItems: async function (params) {
    var provider = lists.get(params.view);
    if (!provider) throw new Error("No list " + params.view);
    var items = await provider.items(params.parent || undefined);
    return (items || []).map(listItem);
  },
  $listSelect: function (params) {
    var provider = lists.get(params.view);
    if (provider && provider.onSelect) return provider.onSelect(params.item);
  },
  $listCheck: function (params) {
    var provider = lists.get(params.view);
    if (provider && provider.onCheck)
      return provider.onCheck(params.item, !!params.checked);
  },
  $listMove: function (params) {
    var provider = lists.get(params.view);
    if (provider && provider.onMove)
      return provider.onMove(params.item, params.target || null);
  },
  $resolveWebview: function (params) {
    var provider = webviewProviders.get(params.view);
    if (!provider) throw new Error("No webview provider for " + params.view);
    return provider.resolve(webview(params.webview), { state: params.state });
  },
  $resolveFileEditor: function (params) {
    var provider = fileEditorProviders.get(params.viewType);
    if (!provider) throw new Error("No file editor " + params.viewType);
    var file = new OpenFile(params.webview, params.path);
    openFiles.set(params.webview, file);
    return provider.resolve(file, webview(params.webview), {
      target: params.target || null,
    });
  },
  $revealFile: function (params) {
    var file = openFiles.get(params.webview);
    if (file)
      file._reveal.forEach(function (reveal) {
        reveal(params.target);
      });
  },
  $renderCodeBlock: function (params) {
    var provider = codeBlockProviders.get(params.language);
    if (!provider) throw new Error("No code block " + params.language);
    var block = new CodeBlock(params.webview, params);
    codeBlocks.set(params.webview, block);
    return provider.render(block, webview(params.webview));
  },
  $codeBlockChanged: function (params) {
    var block = codeBlocks.get(params.webview);
    if (!block) return;
    block.source = params.source;
    block.meta = params.meta || {};
    block.block = params.block;
    block._changed.forEach(function (changed) {
      changed(params.source);
    });
  },
  $provideCompletions: async function (params) {
    var provider = completionProviders.get(params.id);
    if (!provider) return null;
    var controller = new AbortController();
    completionAsks.set(params.request, controller);
    try {
      var answer = await provider.provideCompletions({
        text: params.text,
        match: params.match,
        inMath: params.inMath,
        query: params.query,
        after: params.after,
        path: params.path,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return null;
      if (Array.isArray(answer)) return plain(answer);
      if (answer && answer.complete === true && Array.isArray(answer.items))
        return { items: plain(answer.items), complete: true };
      return null;
    } finally {
      completionAsks.delete(params.request);
    }
  },
  $cancelCompletions: function (params) {
    var controller = completionAsks.get(params.request);
    if (controller) controller.abort();
  },
  $provideEmbed: async function (params) {
    var provider = embedProviders.get(params.id);
    if (!provider) return null;
    var controller = new AbortController();
    embedAsks.set(params.request, controller);
    try {
      var content = await provider.provideEmbed(params.target, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || !content) return null;
      if (typeof content.markdown !== "string") return null;
      return {
        markdown: content.markdown,
        title: content.title == null ? null : String(content.title),
      };
    } finally {
      embedAsks.delete(params.request);
    }
  },
  $cancelEmbed: function (params) {
    var controller = embedAsks.get(params.request);
    if (controller) controller.abort();
  },
  $historyVersions: async function (params) {
    var source = historySources.get(params.id);
    return source ? plain((await source.versions(params.path)) || []) : [];
  },
  $historyRead: async function (params) {
    var source = historySources.get(params.id);
    return source ? await source.read(params.path, params.version) : null;
  },
  $export: async function (params) {
    var format = exportFormats.get(params.id);
    if (!format) return null;
    return await format.export({
      markdown: params.markdown,
      html: params.html,
      path: params.path,
    });
  },
  $databaseView: async function (params) {
    var view = databaseViews.get(params.id);
    if (!view) return null;
    var html = await view.render(params.data);
    return typeof html === "string" ? html : null;
  },
  $provider: async function (params) {
    var provider = fileProviders.get(params.scheme);
    if (!provider || typeof provider[params.op] !== "function")
      throw new Error(params.scheme + " can't " + params.op + ".");
    var answer = await provider[params.op].apply(provider, params.args);
    if (params.op === "read")
      return answer instanceof Uint8Array ? answer : bytesOf(answer);
    return answer === undefined ? null : plain(answer);
  },
  $conventionRead: async function (params) {
    var reader = conventionReaders.get(params.id);
    if (!reader) return null;
    var found = await reader.read({ root: params.root, text: params.text });
    return found && typeof found === "object" ? plain(found) : null;
  },
  $aiStreamText: function (params) {
    var onText = aiStreams.get(params.stream);
    if (onText) onText(params.text);
    return null;
  },
  $inlineCompletion: async function (params) {
    var source = inlineCompletions.get(params.id);
    if (!source) return null;
    var text = await source.provide({
      before: params.before,
      after: params.after,
      path: params.path,
    });
    return typeof text === "string" ? text : null;
  },
  $contextMenu: async function (params) {
    var provide = menuProviders[params.where];
    return provide ? plain((await provide(params.target)) || []) : [];
  },
  $insertBlockType: async function (params) {
    var type = blockTypes.get(params.id);
    if (type) await type.insert();
  },
  $provideOutline: async function (params) {
    var all = [];
    for (var i = 0; i < outlineProviders.length; i++) {
      var items = await outlineProviders[i].provideOutline(params.blocks);
      if (Array.isArray(items)) all = all.concat(items);
    }
    return plain(all);
  },
  $pickSearch: async function (params) {
    var search = pickSearches[params.id];
    if (!search) return [];
    return plain((await search(params.query)) || []);
  },
  $providePaste: async function (params) {
    var provide = pasteHandlers[params.id];
    if (!provide) return null;
    var markdown = await provide(params.text);
    return typeof markdown === "string" ? markdown : null;
  },
  $provideDrop: async function (params) {
    var provide = dropHandlers[params.id];
    if (!provide) return null;
    var markdown = await provide(params.file);
    return typeof markdown === "string" ? markdown : null;
  },
  $provideHover: async function (params) {
    for (var i = 0; i < hoverProviders.length; i++) {
      var card = await hoverProviders[i].provideHover(params.target);
      if (card && typeof card.markdown === "string")
        return {
          title: card.title == null ? null : String(card.title),
          markdown: card.markdown,
        };
    }
    return null;
  },
  $decorate: async function (params) {
    var out = [];
    for (var i = 0; i < decorationProviders.length; i++) {
      var marks = await decorationProviders[i].decorate(
        params.blocks,
        params.document,
      );
      if (Array.isArray(marks)) out = out.concat(plain(marks));
    }
    return out;
  },
  $diagnose: async function (params) {
    var provider = diagnosticProviders.get(params.id);
    if (!provider) return [];
    var found = await provider.check(params.blocks, params.document);
    return Array.isArray(found) ? plain(found) : [];
  },
  $willSave: async function (params) {
    var current = params.text;
    for (var i = 0; i < willSave.length; i++) {
      var next = await willSave[i]({
        path: params.path,
        text: current,
        trigger: params.trigger,
        blocks: current === params.text ? plain(params.blocks) : [],
      });
      if (typeof next === "string") current = next;
      else if (Array.isArray(next) && current === params.text)
        current = withBlockEdits(current, params.blocks, next);
    }
    return current === params.text ? null : current;
  },
  $willExport: async function (params) {
    var html = params.html;
    var css = "";
    for (var i = 0; i < willExport.length; i++) {
      var answer = await willExport[i]({
        format: params.format,
        path: params.path,
        html: html,
      });
      if (answer && typeof answer.html === "string") html = answer.html;
      if (answer && typeof answer.css === "string") css += "\n" + answer.css;
    }
    return { html: html === params.html ? null : html, css: css || null };
  },
  $uri: async function (params) {
    for (var i = 0; i < uriHandlers.length; i++)
      await uriHandlers[i]({ path: params.path, query: params.query || {} });
    return uriHandlers.length > 0;
  },
  $callAiTool: async function (params) {
    var run = aiTools.get(params.name);
    if (!run) throw new Error("The plugin has no tool " + params.name + ".");
    var out = await run(params.arguments || {});
    return typeof out === "string" ? out : JSON.stringify(out);
  },
  $resolveSettingsPage: function (params) {
    if (!settingsProvider) throw new Error("No settings page");
    return settingsProvider.resolve(webview(params.webview));
  },
  $progressCancel: function (params) {
    var controller = progress.get(params.id);
    if (controller) controller.abort();
  },
  $webviewMessage: function (params) {
    var view = webviews.get(params.webview);
    if (view)
      view._receivers.forEach(function (receive) {
        receive(params.message);
      });
  },
  $webviewDisposed: function (params) {
    var view = webviews.get(params.webview);
    openFiles.delete(params.webview);
    codeBlocks.delete(params.webview);
    if (!view) return;
    webviews.delete(params.webview);
    view._disposers.forEach(function (dispose) {
      dispose();
    });
  },
  // A scheduled job's `run`: the background code's export of that name,
  // given the job and a context of its own.
  $runJob: async function (params) {
    var run = module.exports && module.exports[params.run];
    if (typeof run !== "function")
      throw new Error("The background code exports no " + params.run + ".");
    var ctx = makeContext();
    try {
      await run({ id: params.job, due: new Date(params.due) }, ctx);
    } finally {
      ctx.subscriptions.splice(0).forEach(function (item) {
        try {
          item.dispose();
        } catch (err) {
          console.error(err);
        }
      });
    }
  },
  $event: function (params) {
    if (params.name === "theme") env.theme = params.data;
    if (params.name === "appState") env.appState = params.data;
    if (params.name === "language") env.language = params.data;
    var set = listeners.get(params.name);
    if (set)
      set.forEach(function (callback) {
        try {
          callback(params.data);
        } catch (err) {
          console.error(err);
        }
      });
  },
};

// The window hands over the channel once this frame has loaded: the
// first message from it, with the port and what the plugin is told
// about where it runs.
window.addEventListener("message", function receive(event) {
  if (event.source !== window.parent || app) return;
  var data = event.data;
  if (!data || data.textus !== "init" || !event.ports[0]) return;
  window.removeEventListener("message", receive);
  env = data.env;
  app = createEndpoint(event.ports[0], handlers, 0);
  waiting.splice(0).forEach(function (send) {
    send();
  });
});

// What goes wrong in the plugin's code is told to the window, which
// turns off a plugin that keeps failing.
function report(message) {
  if (app) app.notify("host.error", { message: String(message) });
}
window.addEventListener("error", function (event) {
  report(event.message);
});
window.addEventListener("unhandledrejection", function (event) {
  report(
    (event.reason && event.reason.stack) ||
      (event.reason && event.reason.message) ||
      event.reason,
  );
});

// The plugin's code, wrapped by frames.ts: CommonJS style, as VS Code's
// extensions are - `exports.activate = (ctx) => {...}`.
window.__textusDefine = function (factory) {
  delete window.__textusDefine;
  factory.call(module.exports, module, module.exports, textus);
};
// For code that reaches for the API without the wrapper's argument.
window.textus = textus;
window.parent.postMessage(
  { textus: "ready", key: "__TEXTUS_FRAME_KEY__" },
  "*",
);
