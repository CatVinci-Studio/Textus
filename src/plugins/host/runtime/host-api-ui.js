// The plugin API (host-runtime.ts joins the parts): its place in the app - the
// environment, its words, commands, dialogs, layout and views.

// Each namespace a plugin reaches, as textus.d.ts declares them.
var textus = {};

textus.env = {
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
  onDidCopy: on("copy"),
};

textus.l10n = {
  t: function (key) {
    return localized(
      env.l10n || {},
      env.language || "en",
      String(key),
      Array.prototype.slice.call(arguments, 1),
    );
  },
};

textus.commands = {
  register: function (id, run) {
    return registerCommand(String(id), run, false);
  },
  registerEditorCommand: function (id, run) {
    return registerCommand(String(id), editorCommand(run), true);
  },
  setContext: function (key, value) {
    return call("commands.setContext", {
      key: String(key),
      value: value === undefined ? null : value,
    });
  },
  execute: function (id) {
    return call("commands.execute", {
      command: String(id),
      args: plain(Array.prototype.slice.call(arguments, 1)),
    });
  },
};

textus.ui = {
  notice: function (message, options) {
    return call("ui.notice", {
      text: String(message),
      tone: (options && options.tone) || "info",
      action: options && options.action,
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
    var search = options && options.search;
    var id = typeof search === "function" ? String(++pickSearchCount) : null;
    if (id) pickSearches[id] = search;
    return call("ui.pick", {
      items: plain(items),
      placeholder: options && options.placeholder,
      multiple: !!(options && options.multiple),
      value: options && options.value,
      commands: !!(options && options.commands),
      search: id,
    }).finally(function () {
      if (id) delete pickSearches[id];
    });
  },
  form: function (options) {
    return call("ui.form", plain(options));
  },
  pickDate: function (options) {
    return call("ui.pickDate", plain(options || {}));
  },
  pickColor: function (options) {
    return call("ui.pickColor", plain(options || {}));
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
  // Items for the right-click menu ("editor" or "fileTree"), worked out as
  // it opens: provide(target) answers [{ label, command, args }].
  registerContextMenu: function (where, provide) {
    where = String(where);
    menuProviders[where] = provide;
    quiet(call("ui.registerContextMenu", { where: where }));
    return disposable(function () {
      if (menuProviders[where] !== provide) return;
      delete menuProviders[where];
      quiet(call("ui.unregisterContextMenu", { where: where }));
    });
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
};

textus.layout = {
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
  showSidebarTab: function (id) {
    return call("layout.showSidebarTab", { id: String(id) });
  },
  openSettings: function () {
    return call("layout.openSettings", {});
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
  // Which of the window's panels are open: the sidebar (and its tab),
  // Textus AI's.
  panels: function () {
    return call("layout.panels");
  },
  onDidChangePanels: on("panels"),
  // A floating view (contributes.floatingViews) shown or closed; the
  // user moves, folds and closes it too.
  openFloating: function (viewId) {
    return call("layout.openFloating", { view: String(viewId) });
  },
  closeFloating: function (viewId) {
    return call("layout.closeFloating", { view: String(viewId) });
  },
  floatingViews: function () {
    return call("layout.floatingViews");
  },
  onDidChangeFloating: on("floating"),
  onDidTouchFloating: on("floatingTouch"),
};

textus.views = {
  registerList: function (id, provider) {
    var key = String(id);
    lists.set(key, provider);
    quiet(
      call("views.registerList", {
        view: key,
        select: typeof provider.onSelect === "function",
        check: typeof provider.onCheck === "function",
        move: typeof provider.onMove === "function",
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
  registerEmbed: function (id, provider) {
    var key = String(id);
    embedProviders.set(key, provider);
    quiet(call("views.registerEmbed", { id: key }));
    var handle = disposable(function () {
      if (embedProviders.get(key) !== provider) return;
      embedProviders.delete(key);
      quiet(call("views.unregisterEmbed", { id: key }));
    });
    handle.refresh = function () {
      notify("views.embedRefresh", { id: key });
    };
    return handle;
  },
  registerDatabaseView: function (id, provider) {
    var key = String(id);
    databaseViews.set(key, provider);
    quiet(
      call("views.registerDatabaseView", {
        id: key,
        label: provider.label == null ? undefined : String(provider.label),
        icon: provider.icon == null ? undefined : String(provider.icon),
      }),
    );
    return disposable(function () {
      if (databaseViews.get(key) !== provider) return;
      databaseViews.delete(key);
      quiet(call("views.unregisterDatabaseView", { id: key }));
    });
  },
  databaseViews: function () {
    return call("views.databaseViews");
  },
  renderDatabaseView: function (id, data) {
    return call("views.renderDatabaseView", {
      id: String(id),
      data: plain(data),
    });
  },
  registerSettingsPage: function (provider) {
    settingsProvider = provider;
    return disposable(function () {
      if (settingsProvider === provider) settingsProvider = null;
    });
  },
};
