// The plugin host's runtime, first part (host-runtime.ts joins the parts
// inside one function): the link to the window, shared helpers, webviews,
// storage and the plugin's context.

var API_VERSION = "1.10";
var app = null;
var waiting = [];
var module = { exports: {} };
var commands = new Map();
var lists = new Map();
var webviewProviders = new Map();
var fileEditorProviders = new Map();
var codeBlockProviders = new Map();
var hoverProviders = [];
var pasteHandlers = {};
var outlineProviders = [];
var blockTypes = new Map();
var menuProviders = {};
var historySources = new Map();
var inlineCompletions = new Map();
// Each database view's provider, by its id.
var databaseViews = new Map();
// Each folder convention reader, by its id.
var conventionReaders = new Map();
// Each file provider, by its scheme.
var fileProviders = new Map();
// Each ai.stream call's onText, by its number, while it runs.
var aiStreams = new Map();
var aiStreamCount = 0;
var exportFormats = new Map();
var pickSearches = {};
var pickSearchCount = 0;
var pasteHandlerCount = 0;
var decorationProviders = [];
var diagnosticProviders = new Map();
var syntaxes = new Map();
var completionProviders = new Map();
// Asks the panel may still call off, by request.
var completionAsks = new Map();
var embedProviders = new Map();
var embedAsks = new Map();
var aiTools = new Map();
var uriHandlers = [];
var willSave = [];
/** `text` with each `{ block, markdown }` put in its block, last first. */
function withBlockEdits(text, blocks, edits) {
  var byId = {};
  for (var e = 0; e < edits.length; e++)
    if (edits[e] && typeof edits[e].markdown === "string")
      byId[edits[e].block] = edits[e].markdown;
  for (var b = blocks.length - 1; b >= 0; b--)
    if (Object.prototype.hasOwnProperty.call(byId, blocks[b].id))
      text =
        text.slice(0, blocks[b].from) +
        byId[blocks[b].id] +
        text.slice(blocks[b].to);
  return text;
}
var willExport = [];
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
// A call whose failure is no one's business - but a refused permission
// goes to the plugin's log, where its author finds why nothing happens.
function quiet(promise) {
  promise.catch(refused);
}
function refused(err) {
  var message = String((err && err.message) || err);
  if (/was not granted/.test(message))
    notify("log", { level: "error", message: message });
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
      call("events.subscribe", { name: name }).catch(refused);
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

// localized(l10n, language, key, args): the frame is given it
// (plugin-string.ts).

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
  this.meta = params.meta || {};
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

// What the plugin keeps for one document: one value in its global
// store, `doc:<path>`, that Textus moves when the document is renamed
// (store/document-data.ts).
function documentPlace(path) {
  var key = "doc:" + String(path);
  var global = storagePlace("global");
  var all = function () {
    return global.get(key).then(function (value) {
      return value && typeof value === "object" ? value : {};
    });
  };
  return {
    get: function (name) {
      return all().then(function (values) {
        return values[String(name)];
      });
    },
    set: function (name, value) {
      return all().then(function (values) {
        if (value === undefined || value === null) delete values[name];
        else values[String(name)] = plain(value);
        return global.set(key, Object.keys(values).length ? values : null);
      });
    },
    delete: function (name) {
      return this.set(name, null);
    },
    keys: function () {
      return all().then(Object.keys);
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
      document: documentPlace,
    },
    secrets: {
      get: function (key) {
        return call("secrets.get", { key: String(key) });
      },
      set: function (key, value) {
        // Nothing to keep is the secret gone, not the word "null".
        return call("secrets.set", {
          key: String(key),
          value: value == null ? null : String(value),
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

function asDate(value) {
  var at =
    value instanceof Date
      ? value
      : new Date(value === undefined ? Date.now() : value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    at = new Date(value + "T00:00:00");
  if (isNaN(at.getTime())) throw new Error("Not a date: " + value);
  return at;
}

// One per language: made anew for each comparison, a sort is slow.
var collators = {};
function collatorFor(language) {
  if (!collators[language])
    collators[language] = new Intl.Collator(language, {
      numeric: true,
      sensitivity: "base",
    });
  return collators[language];
}

function languageOf(options) {
  return (options && options.language) || env.language || "en";
}

/** A template filled in as Obsidian's Templates (in the folder's date and
 *  time formats, read when the plugin may read files) and then
 *  Templater's common tags. */
async function fillTemplate(text, o) {
  var language = languageOf(o);
  var now = o.now ? asDate(o.now) : new Date();
  var day = o.date === undefined ? now : asDate(o.date);
  var formats = {};
  if (!o.format && (!o.dateFormat || !o.timeFormat)) {
    var found = await call("files.conventions", { path: null }).catch(
      function () {
        return null;
      },
    );
    // An app's settings count here whether or not the folder took them.
    var set =
      found &&
      (found.templateFormats ||
        (found.detected && found.detected.templateFormats));
    formats = (set && set.value) || {};
  }
  var values = Object.assign({}, o.values);
  if (o.title !== undefined && !("title" in values)) values.title = o.title;
  var T = __textusText.dates;
  var body = o.format
    ? T.fillNote(text, day, {
        format: o.format,
        language: language,
        title: o.title,
        now: now,
        values: values,
      })
    : T.fill(text, {
        day: day,
        now: now,
        language: language,
        dateFormat: o.dateFormat || formats.date || undefined,
        timeFormat: o.timeFormat || formats.time || undefined,
        values: values,
      });
  var done = __textusText.templater.fill(body, {
    title: o.title === undefined ? "" : String(o.title),
    folder: o.folder || "",
    now: day,
    language: language,
  });
  return { text: done.text, cursor: done.cursor, skipped: done.skipped };
}

function where(options) {
  return (options && options.where) || "tab";
}
