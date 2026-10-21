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
        return call("window.openView", { view: viewId, options: options || {} });
      },
      openFile: function (path, options) {
        return call("window.openFile", {
          path: String(path),
          heading: options && options.heading,
        });
      },
      openExternal: function (url) {
        return call("window.openExternal", { url: String(url) });
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
              return Promise.resolve(JSON.parse(new TextDecoder().decode(r.body)));
            },
          };
        });
      },
    },
    storage: {
      get: function (key) {
        return call("storage.get", { key: String(key) });
      },
      set: function (key, value) {
        return call("storage.set", {
          key: String(key),
          value: value === undefined ? null : value,
        });
      },
    },
    settings: {
      get: function (key) {
        return call("settings.get", { key: String(key) });
      },
      onDidChange: function (callback) {
        return on("settings", callback);
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
