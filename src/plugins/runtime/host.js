// The plugin host's runtime: the `textus` API a plugin's code is given,
// run in the plugin's hidden, sandboxed frame (frames.ts) before its code.
// Every call goes to the window as JSON-RPC (rpc.ts's createEndpoint, put
// in front of this file); the window checks it against what the plugin was
// granted. The API is docs/dev/textus.d.ts, which
// src/plugins/textus-types.test.ts keeps in step with this file.
//
// Plain JavaScript, put into the frame as is: no imports, nothing of the
// app's build.
/* global createEndpoint */
(function () {
  "use strict";
  var API_VERSION = "1.0";
  var app = null;
  var waiting = [];
  var module = { exports: {} };
  var commands = new Map();
  var lists = new Map();
  var webviewProviders = new Map();
  var fileEditorProviders = new Map();
  var codeBlockProviders = new Map();
  var hoverProviders = [];
  var decorationProviders = [];
  var completionProviders = new Map();
  var aiTools = new Map();
  var uriHandlers = [];
  var willSave = [];
  var settingsProvider = null;
  var webviews = new Map();
  var listeners = new Map();
  var progress = new Map();
  var exported = null;
  var context = null;
  var env = {};

  function call(method, params) {
    if (app) return app.call(method, params);
    return new Promise(function (resolve, reject) {
      waiting.push(function () {
        app.call(method, params).then(resolve, reject);
      });
    });
  }
  function notify(method, params) {
    if (app) app.notify(method, params);
    else
      waiting.push(function () {
        app.notify(method, params);
      });
  }
  function quiet(promise) {
    promise.catch(function () {});
  }
  function disposable(fn) {
    var done = false;
    return {
      dispose: function () {
        if (done) return;
        done = true;
        fn();
      },
    };
  }
  /** Takes `item` out of `array` (a provider list). */
  function without(array, item) {
    var at = array.indexOf(item);
    if (at >= 0) array.splice(at, 1);
  }
  // An event a plugin listens to: told to the window the first time, so
  // the window sends only what someone here wants.
  function on(name) {
    return function (callback) {
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
    };
  }
  function decode(bytes) {
    return new TextDecoder().decode(bytes);
  }
  function bytesOf(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new TextEncoder().encode(String(data));
  }
  /** What can cross to the window: functions left out, everything else -
   *  bytes, dates - as it is (the channel copies it as postMessage does). */
  function plain(value) {
    if (typeof value === "function") return undefined;
    if (value === null || typeof value !== "object") return value;
    if (
      ArrayBuffer.isView(value) ||
      value instanceof ArrayBuffer ||
      value instanceof Date ||
      value instanceof Blob
    )
      return value;
    if (Array.isArray(value)) return value.map(plain);
    const out = {};
    Object.keys(value).forEach(function (key) {
      const v = plain(value[key]);
      if (v !== undefined) out[key] = v;
    });
    return out;
  }
  function text(value) {
    return value === undefined || value === null ? "" : String(value);
  }

  // A string of the plugin's manifest (`l10n`) in the UI's language: its
  // own, then its base language's ("zh-Hant" -> "zh"), then English, then
  // the key. "{0}", "{1}"... are the arguments after it.
  function localized(l10n, language, key, args) {
    var base = String(language).split("-")[0];
    var value =
      (l10n[language] && l10n[language][key]) ||
      (l10n[base] && l10n[base][key]) ||
      (l10n.en && l10n.en[key]) ||
      key;
    return value.replace(/\{(\d+)\}/g, function (all, n) {
      return args[n] === undefined ? all : String(args[n]);
    });
  }

  // ---------------------------------------------------------------
  // Webviews and the files and blocks they show
  // ---------------------------------------------------------------

  function Webview(id) {
    this.id = id;
    this._html = "";
    this._receivers = new Set();
    this._disposers = new Set();
    this.onDidReceiveMessage = subscriber(this._receivers);
    this.onDidDispose = subscriber(this._disposers);
  }
  function subscriber(set) {
    return function (callback) {
      set.add(callback);
      return disposable(function () {
        set.delete(callback);
      });
    };
  }
  Object.defineProperty(Webview.prototype, "html", {
    get: function () {
      return this._html;
    },
    set: function (html) {
      this._html = String(html);
      // A webview closed before its page arrived is no failure of the
      // plugin's.
      quiet(call("webview.setHtml", { webview: this.id, html: this._html }));
    },
  });
  Webview.prototype.postMessage = function (message) {
    return call("webview.postMessage", {
      webview: this.id,
      message: plain(message),
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

  // The file a file editor is opened on.
  function OpenFile(webviewId, path) {
    this.path = path;
    this.fileName = path.split(/[\\/]/).pop();
    this._webview = webviewId;
    this._reveal = new Set();
    this.onDidRequestReveal = subscriber(this._reveal);
  }
  OpenFile.prototype.readFile = function () {
    return call("webview.readFile", { webview: this._webview });
  };
  OpenFile.prototype.readText = function () {
    return this.readFile().then(decode);
  };
  OpenFile.prototype.writeText = function (value) {
    return call("webview.writeFile", {
      webview: this._webview,
      text: String(value),
    });
  };

  // A code block a plugin draws.
  function CodeBlock(webviewId, params) {
    this.language = params.language;
    this.source = params.source;
    this.path = params.path;
    this.block = params.block;
    this._webview = webviewId;
    this._changed = new Set();
    this.onDidChange = subscriber(this._changed);
  }
  CodeBlock.prototype.setSource = function (source) {
    return call("codeBlock.setSource", {
      webview: this._webview,
      source: String(source),
    });
  };
  var openFiles = new Map();
  var codeBlocks = new Map();

  // ---------------------------------------------------------------
  // The API
  // ---------------------------------------------------------------

  function storagePlace(scope) {
    return {
      get: function (key) {
        return call("store.get", { scope: scope, key: String(key) });
      },
      set: function (key, value) {
        return call("store.set", {
          scope: scope,
          key: String(key),
          value: value === undefined ? null : plain(value),
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
      writeText: function (path, value) {
        return call("store.write", {
          scope: scope,
          path: String(path),
          text: String(value),
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

  function log(level) {
    return function () {
      var message = Array.prototype.map
        .call(arguments, function (part) {
          if (typeof part === "string") return part;
          if (part instanceof Error) return part.stack || part.message;
          try {
            return JSON.stringify(part);
          } catch {
            return String(part);
          }
        })
        .join(" ");
      notify("log", { level: level, message: message });
    };
  }

  function makeContext() {
    return {
      subscriptions: [],
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
          return this.readFile(path).then(decode);
        },
      },
      storage: {
        global: storagePlace("global"),
        project: storagePlace("project"),
      },
      secrets: {
        get: function (key) {
          return call("secrets.get", { key: String(key) });
        },
        set: function (key, value) {
          return call("secrets.set", {
            key: String(key),
            value: String(value),
          });
        },
        delete: function (key) {
          return call("secrets.set", { key: String(key), value: null });
        },
      },
      log: { info: log("info"), warn: log("warn"), error: log("error") },
    };
  }

  function editorCommand(run) {
    return function () {
      return run.apply(null, [textus.editor].concat([].slice.call(arguments)));
    };
  }

  function registerCommand(id, run, editor) {
    commands.set(id, run);
    quiet(call("commands.register", { command: id, editor: !!editor }));
    return disposable(function () {
      commands.delete(id);
      quiet(call("commands.unregister", { command: id }));
    });
  }

  function where(options) {
    return (options && options.where) || "tab";
  }

  var textus = {
    env: {
      get language() {
        return env.language;
      },
      get appVersion() {
        return env.appVersion;
      },
      get apiVersion() {
        return API_VERSION;
      },
      get platform() {
        return env.platform;
      },
      get theme() {
        return env.theme;
      },
      onDidChangeTheme: on("theme"),
      onDidChangeLanguage: on("language"),
      readClipboard: function () {
        return call("clipboard.readText");
      },
      writeClipboard: function (value) {
        return call("clipboard.writeText", { text: String(value) });
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
      register: function (id, run) {
        return registerCommand(String(id), run, false);
      },
      registerEditorCommand: function (id, run) {
        return registerCommand(String(id), editorCommand(run), true);
      },
      execute: function (id) {
        return call("commands.execute", {
          command: String(id),
          args: plain(Array.prototype.slice.call(arguments, 1)),
        });
      },
    },
    ui: {
      notice: function (message, options) {
        return call("ui.notice", {
          text: String(message),
          tone: (options && options.tone) || "info",
        });
      },
      message: function (message, options) {
        return call("ui.message", {
          text: String(message),
          tone: (options && options.tone) || "info",
        });
      },
      confirm: function (message, options) {
        return call("ui.confirm", {
          text: String(message),
          okLabel: options && options.okLabel,
          danger: !!(options && options.danger),
        });
      },
      input: function (options) {
        return call("ui.input", plain(options || {}));
      },
      pick: function (items, options) {
        return call("ui.pick", {
          items: plain(items),
          placeholder: options && options.placeholder,
          multiple: !!(options && options.multiple),
        });
      },
      form: function (options) {
        return call("ui.form", plain(options));
      },
      withProgress: function (title, task) {
        var controller = new AbortController();
        return call("ui.progressStart", { title: String(title) }).then(
          function (id) {
            progress.set(id, controller);
            function report(value) {
              notify("ui.progressReport", {
                id: id,
                fraction: value && value.fraction,
                message: value && value.message,
              });
            }
            function end() {
              progress.delete(id);
              notify("ui.progressEnd", { id: id });
            }
            return Promise.resolve()
              .then(function () {
                return task(report, controller.signal);
              })
              .then(
                function (value) {
                  end();
                  return value;
                },
                function (err) {
                  end();
                  throw err;
                },
              );
          },
        );
      },
      statusItem: function (id, item) {
        var key = String(id);
        var current = Object.assign({ text: "" }, plain(item));
        function send() {
          quiet(
            call("ui.setStatusItem", {
              id: key,
              text: text(current.text),
              tooltip: current.tooltip,
              command: current.command,
            }),
          );
        }
        send();
        var handle = disposable(function () {
          quiet(call("ui.removeStatusItem", { id: key }));
        });
        handle.update = function (change) {
          Object.assign(current, plain(change));
          send();
        };
        return handle;
      },
    },
    layout: {
      open: function (target, options) {
        var location =
          typeof target === "string" ? { path: target } : plain(target);
        return call("layout.open", {
          location: location,
          where: where(options),
          asDocument: !!(options && options.asDocument),
        });
      },
      openView: function (viewId, options) {
        return call("layout.openView", {
          view: String(viewId),
          where: where(options),
          title: options && options.title,
          state: options && plain(options.state),
        });
      },
      openWebPage: function (url, options) {
        return call("layout.openWebPage", {
          url: String(url),
          where: where(options),
          title: options && options.title,
        });
      },
      openUntitled: function (content, options) {
        return call("layout.openUntitled", {
          text: String(content),
          where: where(options),
          title: options && options.title,
        });
      },
      openExternal: function (url) {
        return call("layout.openExternal", { url: String(url) });
      },
      activeTab: function () {
        return call("layout.activeTab");
      },
      tabs: function () {
        return call("layout.tabs");
      },
      split: function () {
        return call("layout.split");
      },
      onDidChangeActiveTab: on("activeTab"),
      onDidChangeLayout: on("layout"),
    },
    views: {
      registerList: function (id, provider) {
        var key = String(id);
        lists.set(key, provider);
        quiet(
          call("views.registerList", {
            view: key,
            select: typeof provider.onSelect === "function",
            check: typeof provider.onCheck === "function",
            filterPlaceholder: provider.filterPlaceholder,
            emptyText: provider.emptyText,
          }),
        );
        var handle = disposable(function () {
          if (lists.get(key) === provider) lists.delete(key);
          quiet(call("views.unregisterList", { view: key }));
        });
        handle.refresh = function () {
          notify("views.listRefresh", { view: key });
        };
        handle.setMessage = function (message) {
          notify("views.listMessage", { view: key, text: text(message) });
        };
        return handle;
      },
      registerWebview: function (id, provider) {
        webviewProviders.set(String(id), provider);
        return disposable(function () {
          webviewProviders.delete(String(id));
        });
      },
      registerFileEditor: function (viewType, provider) {
        fileEditorProviders.set(String(viewType), provider);
        return disposable(function () {
          fileEditorProviders.delete(String(viewType));
        });
      },
      registerCodeBlock: function (language, provider) {
        var key = String(language).toLowerCase();
        codeBlockProviders.set(key, provider);
        return disposable(function () {
          if (codeBlockProviders.get(key) === provider)
            codeBlockProviders.delete(key);
        });
      },
      registerSettingsPage: function (provider) {
        settingsProvider = provider;
        return disposable(function () {
          if (settingsProvider === provider) settingsProvider = null;
        });
      },
    },
    editor: {
      getPath: function () {
        return call("editor.getPath");
      },
      getText: function () {
        return call("editor.getText");
      },
      getSelection: function () {
        return call("editor.getSelection");
      },
      getBlocks: function () {
        return call("editor.getBlocks");
      },
      getOutline: function () {
        return call("editor.getOutline");
      },
      edit: function (changes) {
        return call("editor.edit", {
          changes: plain(Array.isArray(changes) ? changes : [changes]),
        });
      },
      insertText: function (value) {
        return call("editor.edit", {
          changes: [{ action: "insert_at_cursor", text: String(value) }],
        });
      },
      replaceSelection: function (value) {
        return call("editor.edit", {
          changes: [{ action: "replace_selection", text: String(value) }],
        });
      },
      propose: function (change, options) {
        return call("editor.propose", {
          change: plain(change),
          reason: options && options.reason,
        });
      },
      reveal: function (location) {
        return call("editor.reveal", { location: plain(location) });
      },
      registerCompletion: function (id, provider) {
        var key = String(id);
        completionProviders.set(key, provider);
        return disposable(function () {
          if (completionProviders.get(key) === provider)
            completionProviders.delete(key);
        });
      },
      registerHover: function (provider) {
        hoverProviders.push(provider);
        quiet(call("editor.registerHover", {}));
        return disposable(function () {
          without(hoverProviders, provider);
        });
      },
      registerDecorations: function (provider) {
        decorationProviders.push(provider);
        quiet(call("editor.registerDecorations", {}));
        return disposable(function () {
          without(decorationProviders, provider);
          if (!decorationProviders.length)
            quiet(call("editor.unregisterDecorations", {}));
        });
      },
      onDidChangeActive: on("activeDocument"),
      onDidChange: on("documentChange"),
      onDidChangeSelection: on("selection"),
      keys: {
        capture: function (capture) {
          return call("editor.captureKeys", plain(capture) || null);
        },
        onKey: on("editorKey"),
        exec: function (op) {
          return call("editor.exec", plain(op));
        },
      },
    },
    files: {
      root: function () {
        return call("files.root");
      },
      list: function (dir) {
        return call("files.list", { path: text(dir) });
      },
      find: function (glob) {
        return call("files.find", {
          glob: glob === undefined ? null : String(glob),
        });
      },
      stat: function (path) {
        return call("files.stat", { path: String(path) });
      },
      read: function (path) {
        return call("files.read", { path: String(path) });
      },
      readText: function (path) {
        return textus.files.read(path).then(decode);
      },
      write: function (path, data) {
        return call("files.write", { path: String(path), data: bytesOf(data) });
      },
      writeText: function (path, value) {
        return call("files.writeText", {
          path: String(path),
          text: String(value),
        });
      },
      create: function (path, value) {
        return call("files.create", { path: String(path), text: text(value) });
      },
      process: async function (path, change) {
        for (var attempt = 0; attempt < 4; attempt++) {
          var read = await call("files.processRead", { path: String(path) });
          var next = await change(read.text);
          if (typeof next !== "string" || next === read.text) return read.text;
          var written = await call("files.processWrite", {
            path: String(path),
            text: next,
            token: read.token,
          });
          if (written) return next;
        }
        throw new Error(
          String(path) + " kept changing while it was processed.",
        );
      },
      rename: function (from, to, options) {
        return call("files.rename", {
          from: String(from),
          to: String(to),
          updateLinks: !!(options && options.updateLinks),
        });
      },
      trash: function (path) {
        return call("files.trash", { path: String(path) });
      },
      createFolder: function (path) {
        return call("files.createFolder", { path: String(path) });
      },
      frontmatter: {
        get: function (path) {
          return call("files.frontmatterGet", { path: String(path) });
        },
        update: async function (path, change) {
          var current = await call("files.frontmatterGet", {
            path: String(path),
          });
          var next = change(current);
          await call("files.frontmatterSet", {
            path: String(path),
            frontmatter: plain(next === undefined ? current : next),
          });
        },
      },
      onDidCreate: on("fileCreate"),
      onDidChange: on("fileChange"),
      onDidRename: on("fileRename"),
      onDidDelete: on("fileDelete"),
      onWillSave: function (listener) {
        willSave.push(listener);
        if (willSave.length === 1) quiet(call("files.willSave", { on: true }));
        return disposable(function () {
          without(willSave, listener);
          if (!willSave.length) quiet(call("files.willSave", { on: false }));
        });
      },
      onDidSave: on("didSave"),
      onDidChangeRoot: on("root"),
    },
    metadata: {
      get: function (path) {
        return call("metadata.get", { path: String(path) });
      },
      all: function () {
        return call("metadata.all");
      },
      backlinks: function (path) {
        return call("metadata.backlinks", { path: String(path) });
      },
      resolveLink: function (link, from) {
        return call("metadata.resolveLink", {
          link: String(link),
          from: String(from),
        });
      },
      tags: function () {
        return call("metadata.tags");
      },
      tasks: function (filter) {
        return call("metadata.tasks", plain(filter || {}));
      },
      search: function (query, options) {
        return call("metadata.search", {
          query: String(query),
          limit: options && options.limit,
        });
      },
      onDidChange: on("metadata"),
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
              return Promise.resolve(decode(r.body));
            },
            json: function () {
              return Promise.resolve(JSON.parse(decode(r.body)));
            },
          };
        });
      },
    },
    settings: {
      get: function (key) {
        return call("settings.get", { key: String(key) });
      },
      set: function (key, value) {
        return call("settings.set", { key: String(key), value: plain(value) });
      },
      onDidChange: on("settings"),
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
    plugins: {
      get: function (id) {
        var other = String(id);
        return call("plugins.exports", { id: other }).then(function (names) {
          if (!names) return null;
          var api = {};
          names.forEach(function (name) {
            api[name] = function () {
              return call("plugins.call", {
                id: other,
                name: name,
                args: plain(Array.prototype.slice.call(arguments)),
              });
            };
          });
          return api;
        });
      },
    },
    uri: {
      registerHandler: function (handler) {
        uriHandlers.push(handler);
        return disposable(function () {
          without(uriHandlers, handler);
        });
      },
    },
  };

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
      block.block = params.block;
      block._changed.forEach(function (changed) {
        changed(params.source);
      });
    },
    $provideCompletions: async function (params) {
      var provider = completionProviders.get(params.id);
      if (!provider) return null;
      var items = await provider.provideCompletions({
        text: params.text,
        match: params.match,
        inMath: params.inMath,
      });
      return Array.isArray(items) ? plain(items) : null;
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
        var marks = await decorationProviders[i].decorate(params.blocks);
        if (Array.isArray(marks)) out = out.concat(plain(marks));
      }
      return out;
    },
    $willSave: async function (params) {
      var current = params.text;
      for (var i = 0; i < willSave.length; i++) {
        var next = await willSave[i]({ path: params.path, text: current });
        if (typeof next === "string") current = next;
      }
      return current === params.text ? null : current;
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
  window.parent.postMessage({ textus: "ready" }, "*");
})();
