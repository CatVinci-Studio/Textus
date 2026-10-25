// The plugin host's runtime: the `textus` API a plugin's code is given,
// run in the plugin's hidden, sandboxed frame (frames.ts) before its code.
// Every call goes to the window as JSON-RPC (rpc.ts's createEndpoint, put
// in front of this file); the window checks it against what the plugin was
// granted. The API itself is described in docs/dev/plugin-api.md.
//
// Plain JavaScript, put into the frame as is: no imports, nothing of the
// app's build.
/* global createEndpoint */
(function () {
  "use strict";
  var app = null;
  var waiting = [];
  var module = { exports: {} };
  var commands = new Map();
  var viewProviders = new Map();
  var editorProviders = new Map();
  var hoverProviders = [];
  // Completion providers by the id their manifest's contributes
  // .completions gives.
  var completionProviders = new Map();
  var aiTools = new Map();
  var settingsProvider = null;
  var webviews = new Map();
  var listeners = new Map();
  var env = {};

  function call(method, params) {
    if (app) return app.call(method, params);
    return new Promise(function (resolve, reject) {
      waiting.push(function () {
        app.call(method, params).then(resolve, reject);
      });
    });
  }
  function disposable(fn) {
    return { dispose: fn };
  }
  function on(name, callback) {
    if (!listeners.has(name)) {
      listeners.set(name, new Set());
      call("events.subscribe", { name: name }).catch(function (err) {
        console.error(err);
      });
    }
    listeners.get(name).add(callback);
    return disposable(function () {
      listeners.get(name).delete(callback);
    });
  }

  function Webview(id) {
    this.id = id;
    this._html = "";
    this._receivers = new Set();
    this._disposers = new Set();
  }
  Object.defineProperty(Webview.prototype, "html", {
    get: function () {
      return this._html;
    },
    set: function (html) {
      this._html = String(html);
      // A webview closed before its page arrived is no failure of the
      // plugin's.
      call("webview.setHtml", { webview: this.id, html: this._html }).catch(
        function () {},
      );
    },
  });
  Webview.prototype.postMessage = function (message) {
    return call("webview.postMessage", { webview: this.id, message: message });
  };
  Webview.prototype.onDidReceiveMessage = function (callback) {
    var set = this._receivers;
    set.add(callback);
    return disposable(function () {
      set.delete(callback);
    });
  };
  Webview.prototype.onDidDispose = function (callback) {
    var set = this._disposers;
    set.add(callback);
    return disposable(function () {
      set.delete(callback);
    });
  };
  // A file of the plugin's, for the webview's HTML: the window puts the
  // file itself in its place when the HTML is set.
  Webview.prototype.asWebviewUri = function (path) {
    return "textus-resource:" + String(path).replace(/^\.?\//, "");
  };
  Webview.prototype.setTitle = function (title) {
    return call("webview.setTitle", { webview: this.id, title: String(title) });
  };

  function webview(id) {
    var view = webviews.get(id);
    if (!view) {
      view = new Webview(id);
      webviews.set(id, view);
    }
    return view;
  }

  // What a custom editor is opened on.
  function CustomDocument(webviewId, path) {
    this.path = path;
    this.fileName = path.split(/[\\/]/).pop();
    this._webview = webviewId;
  }
  CustomDocument.prototype.readBytes = function () {
    return call("document.readResource", { webview: this._webview });
  };
  CustomDocument.prototype.readText = function () {
    return this.readBytes().then(function (bytes) {
      return new TextDecoder().decode(bytes);
    });
  };
  CustomDocument.prototype.writeText = function (text) {
    return call("document.writeResource", {
      webview: this._webview,
      text: String(text),
    });
  };

  function bytesOf(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new TextEncoder().encode(String(data));
  }

  // A string of the plugin's manifest (`l10n`) in the UI's language: its
  // own, then its base language's ("zh-Hant" -> "zh"), then English, then
  // the key. "{0}", "{1}"... are the arguments after it.
  function localized(l10n, language, key, args) {
    var base = String(language).split("-")[0];
    var text =
      (l10n[language] && l10n[language][key]) ||
      (l10n[base] && l10n[base][key]) ||
      (l10n.en && l10n.en[key]) ||
      key;
    return text.replace(/\{(\d+)\}/g, function (all, n) {
      return args[n] === undefined ? all : String(args[n]);
    });
  }

  var textus = {
    plugin: {
      get id() {
        return env.pluginId;
      },
      get version() {
        return env.pluginVersion;
      },
      readFile: function (path) {
        return call("plugin.readFile", { path: String(path) });
      },
      readText: function (path) {
        return textus.plugin.readFile(path).then(function (bytes) {
          return new TextDecoder().decode(bytes);
        });
      },
    },
    env: {
      get language() {
        return env.language;
      },
      get appVersion() {
        return env.appVersion;
      },
      get platform() {
        return env.platform;
      },
      get theme() {
        return env.theme;
      },
      onDidChangeTheme: function (callback) {
        return on("theme", callback);
      },
      onDidChangeLanguage: function (callback) {
        return on("language", callback);
      },
    },
    l10n: {
      t: function (key) {
        return localized(
          env.l10n || {},
          env.language || "en",
          String(key),
          Array.prototype.slice.call(arguments, 1),
        );
      },
    },
    commands: {
      registerCommand: function (id, run) {
        commands.set(id, run);
        call("commands.register", { command: id }).catch(function () {});
        return disposable(function () {
          commands.delete(id);
          call("commands.unregister", { command: id }).catch(function () {});
        });
      },
      executeCommand: function (id) {
        var args = Array.prototype.slice.call(arguments, 1);
        return call("commands.execute", { command: id, args: args });
      },
    },
    window: {
      showMessage: function (text, options) {
        return call("window.showMessage", {
          text: String(text),
          tone: (options && options.tone) || "info",
        });
      },
      showInput: function (options) {
        return call("window.showInput", options || {});
      },
      showQuickPick: function (items, options) {
        return call("window.showQuickPick", {
          items: items,
          placeholder: options && options.placeholder,
        });
      },
      openView: function (viewId, options) {
        return call("window.openView", {
          view: viewId,
          options: options || {},
        });
      },
      openFile: function (path, options) {
        return call("window.openFile", {
          path: String(path),
          heading: options && options.heading,
          asDocument: Boolean(options && options.asDocument),
        });
      },
      openWebPage: function (url, options) {
        return call("window.openWebPage", {
          url: String(url),
          title: options && options.title,
        });
      },
      setStatusItem: function (id, item) {
        item = item || {};
        call("window.setStatusItem", {
          id: String(id),
          text: String(item.text || ""),
          tooltip: item.tooltip,
          command: item.command,
        }).catch(function () {});
        return disposable(function () {
          call("window.removeStatusItem", { id: String(id) }).catch(
            function () {},
          );
        });
      },
      openExternal: function (url) {
        return call("window.openExternal", { url: String(url) });
      },
      splitEditor: function (direction) {
        return call("window.splitEditor", { direction: direction || "row" });
      },
      closeSplit: function () {
        return call("window.closeSplit", {});
      },
      layout: function () {
        return call("window.layout", {});
      },
      openUntitled: function (content, options) {
        return call("window.openUntitled", {
          content: String(content),
          title: options && options.title,
        });
      },
      registerWebviewViewProvider: function (viewId, provider) {
        viewProviders.set(viewId, provider);
        return disposable(function () {
          viewProviders.delete(viewId);
        });
      },
      registerCustomEditorProvider: function (viewType, provider) {
        editorProviders.set(viewType, provider);
        return disposable(function () {
          editorProviders.delete(viewType);
        });
      },
      registerSettingsPage: function (provider) {
        settingsProvider = provider;
        return disposable(function () {
          settingsProvider = null;
        });
      },
    },
    editor: {
      // { mode: "all" | "some", keys: ["Escape", "ctrl+["] }, or null to
      // give the keyboard back. Needs editor.input.
      captureKeys: function (capture) {
        return call("editor.captureKeys", capture || null);
      },
      onKey: function (callback) {
        return on("editorKey", callback);
      },
      exec: function (op) {
        return call("editor.exec", op);
      },
      // What the pointer rests on in the editor - a link to a document, any
      // other link, or a citation [@key] - shown as a card: provider
      // .provideHover(target) returns { title, markdown }, or null for
      // targets it has nothing for. Needs document.read.
      // The completions for one of the manifest's contributes.completions:
      // provider.provideCompletions({ text, match, inMath }) returns
      // [{ label, insert, detail }] ("$0" in insert marks the caret), or
      // nothing. Asked only when what is before the caret matches.
      registerCompletionProvider: function (id, provider) {
        completionProviders.set(String(id), provider);
        return disposable(function () {
          if (completionProviders.get(String(id)) === provider)
            completionProviders.delete(String(id));
        });
      },
      registerHoverProvider: function (provider) {
        hoverProviders.push(provider);
        call("editor.registerHoverProvider", {}).catch(function () {});
        return disposable(function () {
          hoverProviders = hoverProviders.filter(function (p) {
            return p !== provider;
          });
        });
      },
    },
    document: {
      getText: function () {
        return call("document.getText");
      },
      getPath: function () {
        return call("document.getPath");
      },
      getSelection: function () {
        return call("document.getSelection");
      },
      getBlocks: function () {
        return call("document.getBlocks");
      },
      getOutline: function () {
        return call("document.getOutline");
      },
      proposeEdit: function (edit) {
        return call("document.proposeEdit", edit);
      },
      onDidChangeActive: function (callback) {
        return on("activeDocument", callback);
      },
    },
    workspace: {
      rootPath: function () {
        return call("workspace.rootPath");
      },
      list: function (path) {
        return call("workspace.list", { path: String(path || "") });
      },
      findDocuments: function () {
        return call("workspace.findDocuments");
      },
      readDocuments: function () {
        return call("workspace.readDocuments");
      },
      search: function (query, options) {
        return call("workspace.search", {
          query: String(query),
          limit: options && options.limit,
        });
      },
      readFile: function (path) {
        return call("workspace.readFile", { path: String(path) });
      },
      readText: function (path) {
        return textus.workspace.readFile(path).then(function (bytes) {
          return new TextDecoder().decode(bytes);
        });
      },
      writeText: function (path, text) {
        return call("workspace.writeText", {
          path: String(path),
          text: String(text),
        });
      },
      writeFile: function (path, data) {
        return call("workspace.writeFile", {
          path: String(path),
          data: bytesOf(data),
        });
      },
      rename: function (from, to) {
        return call("workspace.rename", { from: String(from), to: String(to) });
      },
      trash: function (path) {
        return call("workspace.trash", { path: String(path) });
      },
      createFolder: function (path) {
        return call("workspace.createFolder", { path: String(path) });
      },
      onDidSaveDocument: function (callback) {
        return on("didSave", callback);
      },
      onDidChangeRoot: function (callback) {
        return on("root", callback);
      },
    },
    net: {
      fetch: function (url, init) {
        init = init || {};
        return call("net.fetch", {
          url: String(url),
          method: init.method,
          headers: init.headers,
          body: init.body === undefined ? undefined : bytesOf(init.body),
        }).then(function (r) {
          return {
            status: r.status,
            ok: r.status >= 200 && r.status < 300,
            headers: r.headers,
            bytes: function () {
              return Promise.resolve(r.body);
            },
            text: function () {
              return Promise.resolve(new TextDecoder().decode(r.body));
            },
            json: function () {
              return Promise.resolve(
                JSON.parse(new TextDecoder().decode(r.body)),
              );
            },
          };
        });
      },
    },
    storage: (function () {
      // One of the plugin's two places: "global" for every document,
      // "project" in the open folder (with project.data).
      function place(scope) {
        return {
          get: function (key) {
            return call("store.get", { scope: scope, key: String(key) });
          },
          set: function (key, value) {
            return call("store.set", {
              scope: scope,
              key: String(key),
              value: value === undefined ? null : value,
            });
          },
          delete: function (key) {
            return call("store.set", {
              scope: scope,
              key: String(key),
              value: null,
            });
          },
          keys: function () {
            return call("store.keys", { scope: scope });
          },
          readText: function (path) {
            return call("store.read", { scope: scope, path: String(path) });
          },
          writeText: function (path, text) {
            return call("store.write", {
              scope: scope,
              path: String(path),
              text: String(text),
            });
          },
          files: function () {
            return call("store.files", { scope: scope });
          },
          deleteFile: function (path) {
            return call("store.delete", { scope: scope, path: String(path) });
          },
        };
      }
      var global = place("global");
      return {
        global: global,
        project: place("project"),
        get: global.get,
        set: global.set,
      };
    })(),
    settings: {
      get: function (key) {
        return call("settings.get", { key: String(key) });
      },
      onDidChange: function (callback) {
        return on("settings", callback);
      },
    },
    ai: {
      // Runs one of the manifest's contributes.aiTools when Textus AI
      // calls it (ai.tools): `run(args)` answers with text for the model.
      registerTool: function (name, run) {
        aiTools.set(String(name), run);
        return disposable(function () {
          aiTools.delete(String(name));
        });
      },
    },
    clipboard: {
      readText: function () {
        return call("clipboard.readText");
      },
      writeText: function (text) {
        return call("clipboard.writeText", { text: String(text) });
      },
    },
  };

  var handlers = {
    $ping: function () {
      return "pong";
    },
    $activate: function () {
      var activate = module.exports && module.exports.activate;
      return activate ? activate({ subscriptions: [] }) : undefined;
    },
    $deactivate: function () {
      var deactivate = module.exports && module.exports.deactivate;
      return deactivate ? deactivate() : undefined;
    },
    $executeCommand: function (params) {
      var run = commands.get(params.command);
      if (!run) throw new Error("No command " + params.command);
      return run.apply(null, params.args || []);
    },
    $resolveWebviewView: function (params) {
      var provider = viewProviders.get(params.view);
      if (!provider) throw new Error("No provider for " + params.view);
      return provider.resolveWebviewView(webview(params.webview), {
        state: params.state,
      });
    },
    $resolveCustomEditor: function (params) {
      var provider = editorProviders.get(params.viewType);
      if (!provider) throw new Error("No custom editor " + params.viewType);
      return provider.resolveCustomEditor(
        new CustomDocument(params.webview, params.path),
        webview(params.webview),
      );
    },
    $provideCompletions: async function (params) {
      var provider = completionProviders.get(params.id);
      if (!provider) return null;
      var items = await provider.provideCompletions({
        text: params.text,
        match: params.match,
        inMath: params.inMath,
      });
      return Array.isArray(items) ? items : null;
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
    $callAiTool: async function (params) {
      var run = aiTools.get(params.name);
      if (!run) throw new Error("The plugin has no tool " + params.name + ".");
      var out = await run(params.arguments || {});
      return typeof out === "string" ? out : JSON.stringify(out);
    },
    $resolveSettingsPage: function (params) {
      if (!settingsProvider) throw new Error("No settings page");
      return settingsProvider.resolveSettingsPage(webview(params.webview));
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
      if (!view) return;
      webviews.delete(params.webview);
      view._disposers.forEach(function (dispose) {
        dispose();
      });
    },
    $event: function (params) {
      if (params.name === "theme") env.theme = params.data;
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
    report((event.reason && event.reason.message) || event.reason);
  });

  // The plugin's code, wrapped by frames.ts: CommonJS style, as VS Code's
  // extensions are - `exports.activate = (context) => {...}`.
  window.__textusDefine = function (factory) {
    delete window.__textusDefine;
    factory.call(module.exports, module, module.exports, textus);
  };
  // For code that reaches for the API without the wrapper's argument.
  window.textus = textus;
  window.parent.postMessage({ textus: "ready" }, "*");
})();
