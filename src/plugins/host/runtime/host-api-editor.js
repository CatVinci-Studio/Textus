// The plugin API: the document being edited, dates and templates, and the
// open folder's files.

textus.editor = {
  getPath: function () {
    return call("editor.getPath");
  },
  getText: function () {
    return call("editor.getText");
  },
  getSelection: function () {
    return call("editor.getSelection");
  },
  getCursor: function () {
    return call("editor.getCursor");
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
  registerPasteHandler: function (pattern, provide) {
    var id = String(++pasteHandlerCount);
    pasteHandlers[id] = provide;
    quiet(
      call("editor.registerPasteHandler", {
        id: id,
        pattern: pattern instanceof RegExp ? pattern.source : String(pattern),
      }),
    );
    return disposable(function () {
      delete pasteHandlers[id];
      quiet(call("editor.unregisterPasteHandler", { id: id }));
    });
  },
  registerDropHandler: function (match, provide) {
    var id = String(++dropHandlerCount);
    dropHandlers[id] = provide;
    quiet(call("editor.registerDropHandler", { id: id, match: plain(match) }));
    return disposable(function () {
      delete dropHandlers[id];
      quiet(call("editor.unregisterDropHandler", { id: id }));
    });
  },
  // A block the / menu offers, named `id` among the plugin's own; its
  // insert() puts it in at the caret.
  registerBlockType: function (id, type) {
    id = String(id);
    blockTypes.set(id, type);
    quiet(
      call("editor.registerBlockType", {
        id: id,
        label: String(type.label),
        keywords: type.keywords ? String(type.keywords) : undefined,
      }),
    );
    return disposable(function () {
      if (blockTypes.get(id) !== type) return;
      blockTypes.delete(id);
      quiet(call("editor.unregisterBlockType", { id: id }));
    });
  },
  blockTypes: function () {
    return call("editor.blockTypes");
  },
  registerOutline: function (provider) {
    outlineProviders.push(provider);
    quiet(call("editor.registerOutline", {}));
    return disposable(function () {
      without(outlineProviders, provider);
      if (!outlineProviders.length) quiet(call("editor.unregisterOutline", {}));
    });
  },
  registerHover: function (provider) {
    hoverProviders.push(provider);
    quiet(call("editor.registerHover", {}));
    return disposable(function () {
      without(hoverProviders, provider);
      if (!hoverProviders.length) quiet(call("editor.unregisterHover", {}));
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
  registerDiagnostics: function (id, provider) {
    var name = String(id);
    diagnosticProviders.set(name, provider);
    quiet(call("editor.registerDiagnostics", { id: name }));
    return disposable(function () {
      if (diagnosticProviders.get(name) !== provider) return;
      diagnosticProviders.delete(name);
      quiet(call("editor.unregisterDiagnostics", { id: name }));
    });
  },
  // Inline syntax shown as it means (`||spoiler||`); display only, the
  // text stays as written.
  registerSyntax: function (id, syntax) {
    var name = String(id);
    var pattern = syntax.pattern;
    var regex = pattern instanceof RegExp;
    syntaxes.set(name, syntax);
    call("editor.registerSyntax", {
      id: name,
      pattern: regex ? pattern.source : String(pattern),
      flags: regex ? pattern.flags : "",
      style: String(syntax.style),
      tone: syntax.tone ? String(syntax.tone) : undefined,
    }).catch(function (err) {
      notify("log", { level: "error", message: String(err.message || err) });
    });
    return disposable(function () {
      if (syntaxes.get(name) !== syntax) return;
      syntaxes.delete(name);
      quiet(call("editor.unregisterSyntax", { id: name }));
    });
  },
  onDidChangeActive: on("activeDocument"),
  onDidChange: on("documentChange"),
  onDidChangeSelection: on("selection"),
  onDidChangeVisible: on("visible"),
  keys: {
    capture: function (capture) {
      return call("editor.captureKeys", plain(capture) || null);
    },
    onKey: on("editorKey"),
    onDidPressKey: on("editorKey"),
    exec: function (op) {
      return call("editor.exec", plain(op));
    },
  },
};

// Dates and templates: computed here, no permission, nothing sent.
textus.dates = {
  format: function (date, form, options) {
    return __textusText.dates.format(
      asDate(date),
      form || "YYYY-MM-DD",
      languageOf(options),
    );
  },
  parse: function (text, form, options) {
    return __textusText.dates.parse(
      String(text),
      form || "YYYY-MM-DD",
      languageOf(options),
    );
  },
};

textus.templates = {
  fill: function (text, options) {
    return fillTemplate(String(text), options || {});
  },
};

textus.files = {
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
  setBadge: function (path, badge) {
    return call("files.setBadge", {
      path: String(path),
      badge: badge ? plain(badge) : null,
    });
  },
  conventions: function (path) {
    return call("files.conventions", {
      path: path === undefined ? null : String(path),
    });
  },
  setConvention: function (key, value) {
    return call("files.setConvention", {
      key: String(key),
      value: value === undefined ? null : plain(value),
    });
  },
  registerProvider: function (scheme, provider) {
    var key = String(scheme).toLowerCase();
    fileProviders.set(key, provider);
    quiet(call("files.registerProvider", { scheme: key }));
    return disposable(function () {
      if (fileProviders.get(key) !== provider) return;
      fileProviders.delete(key);
      quiet(call("files.unregisterProvider", { scheme: key }));
    });
  },
  openFolder: function (url) {
    return call("files.openFolder", { url: String(url) });
  },
  registerConventionReader: function (id, reader) {
    var key = String(id);
    conventionReaders.set(key, reader);
    quiet(
      call("files.registerConventionReader", {
        id: key,
        label: String(reader.label == null ? key : reader.label),
        marker: String(reader.marker),
        notes: !!reader.notes,
      }),
    );
    return disposable(function () {
      if (conventionReaders.get(key) !== reader) return;
      conventionReaders.delete(key);
      quiet(call("files.unregisterConventionReader", { id: key }));
    });
  },
  appSettings: function (app, file, path) {
    return call("files.appSettings", {
      app: String(app),
      file: String(file),
      path: path === undefined ? null : String(path),
    });
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
  create: function (path, value, options) {
    return call("files.create", {
      path: String(path),
      text: text(value),
      unique: !!(options && options.unique),
    });
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
    throw new Error(String(path) + " kept changing while it was processed.");
  },
  blockId: function (path, line) {
    return call("files.blockId", {
      path: String(path),
      line: Number(line),
    });
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
  onDidChangeOnDisk: on("fileChangeOnDisk"),
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
  onDidChangeConventions: on("conventions"),
};
