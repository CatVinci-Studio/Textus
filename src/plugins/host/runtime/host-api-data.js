// The plugin API: what the folder's notes say, Git, the network, settings,
// AI tools, other plugins, export, links, jobs, notices, text, paths and
// the app.

textus.metadata = {
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
  resolveNote: function (link, from) {
    return call("metadata.resolveNote", {
      link: String(link),
      from: String(from),
    });
  },
  linkTo: function (to, from, options) {
    return call("metadata.linkTo", {
      to: String(to),
      from: String(from),
      options: plain(options || {}),
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
};

textus.git = {
  status: function () {
    return call("git.status");
  },
  log: function (path, options) {
    return call("git.log", {
      path: String(path),
      limit: options && options.limit,
    });
  },
  show: function (hash, path) {
    return call("git.show", { hash: String(hash), path: String(path) });
  },
  commit: function (message, paths) {
    return call("git.commit", {
      message: String(message),
      paths: (paths || []).map(String),
    });
  },
};

textus.net = {
  fetch: function (url, init) {
    init = init || {};
    var signal = init.signal;
    if (signal && signal.aborted) return Promise.reject(aborted());
    var cancelId = signal ? fetchMark + ":" + ++fetches : undefined;
    var sent = call("net.fetch", {
      url: String(url),
      method: init.method,
      headers: init.headers,
      body: init.body === undefined ? undefined : bytesOf(init.body),
      cancelId: cancelId,
    });
    if (signal) {
      var stop = function () {
        notify("net.cancel", { cancelId: cancelId });
      };
      signal.addEventListener("abort", stop, { once: true });
      sent = sent.then(
        function (r) {
          signal.removeEventListener("abort", stop);
          return r;
        },
        function (err) {
          signal.removeEventListener("abort", stop);
          throw signal.aborted ? aborted() : err;
        },
      );
    }
    return sent.then(function (r) {
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
};

textus.settings = {
  get: function (key) {
    return call("settings.get", { key: String(key) });
  },
  set: function (key, value) {
    return call("settings.set", { key: String(key), value: plain(value) });
  },
  onDidChange: on("settings"),
};

textus.ai = {
  // Runs one of the manifest's contributes.aiTools when Textus AI
  // calls it (ai.tools): `run(args)` answers with text for the model.
  registerTool: function (name, run) {
    aiTools.set(String(name), run);
    return disposable(function () {
      aiTools.delete(String(name));
    });
  },
  // What Textus AI is doing and with which model, never what it says.
  state: function () {
    return call("ai.state");
  },
  onDidChangeState: on("aiState"),
};

textus.plugins = {
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
};

textus.export = {
  mathCss: function () {
    return call("export.mathCss");
  },
  onWillExport: function (listener) {
    willExport.push(listener);
    if (willExport.length === 1) quiet(call("export.willExport", { on: true }));
    return disposable(function () {
      without(willExport, listener);
      if (!willExport.length) quiet(call("export.willExport", { on: false }));
    });
  },
};

textus.uri = {
  registerHandler: function (handler) {
    uriHandlers.push(handler);
    return disposable(function () {
      without(uriHandlers, handler);
    });
  },
};

// Jobs Rust keeps and fires on time, with Textus's windows open or not.
textus.schedule = {
  set: function (id, job) {
    return call("schedule.set", { id: String(id), job: plain(job) });
  },
  clear: function (id) {
    return call("schedule.clear", { id: String(id) });
  },
  list: function () {
    return call("schedule.list");
  },
};

textus.notify = {
  show: function (notification) {
    return call("notify.show", plain(notification));
  },
};

// Text as the app reads it: the status bar's count, a note's front
// matter apart from its body, names in the file tree's order.
textus.text = {
  count: function (markdown) {
    return call("text.count", { markdown: String(markdown) });
  },
  splitFrontmatter: function (value) {
    return call("text.splitFrontmatter", { text: String(value) });
  },
  parseYaml: function (yaml) {
    return call("text.parseYaml", { yaml: String(yaml) });
  },
  stringifyYaml: function (value) {
    return call("text.stringifyYaml", { value: plain(value) });
  },
  compareNames: function (a, b) {
    var collator = collatorFor(env.language || "en");
    a = String(a);
    b = String(b);
    return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
  },
};

// Paths as Textus writes them: "/" between parts on every system (a "\\"
// is read as one), no permission, nothing leaves the frame.
textus.path = (function () {
  var parts = function (path) {
    return String(path).replace(/\\/g, "/").split("/");
  };
  var normalize = function (path) {
    var text = String(path).replace(/\\/g, "/");
    var lead = text.match(/^(\/|[A-Za-z]:\/)/);
    var out = [];
    parts(text.slice(lead ? lead[0].length : 0)).forEach(function (part) {
      if (part === "" || part === ".") return;
      if (part === ".." && out.length && out[out.length - 1] !== "..")
        out.pop();
      else if (part !== ".." || !lead) out.push(part);
    });
    var joined = (lead ? lead[0] : "") + out.join("/");
    return joined || (lead ? lead[0] : ".");
  };
  var basename = function (path, ext) {
    var name = parts(String(path).replace(/[\\/]+$/, "")).pop() || "";
    return ext && name.length > ext.length && name.slice(-ext.length) === ext
      ? name.slice(0, -ext.length)
      : name;
  };
  return {
    normalize: normalize,
    join: function () {
      return normalize(
        Array.prototype.filter
          .call(arguments, function (part) {
            return part !== "";
          })
          .join("/"),
      );
    },
    dirname: function (path) {
      var norm = normalize(path);
      var at = norm.lastIndexOf("/");
      if (at < 0) return ".";
      return at === 0 || /^[A-Za-z]:\/$/.test(norm.slice(0, at + 1))
        ? norm.slice(0, at + 1)
        : norm.slice(0, at);
    },
    basename: basename,
    extname: function (path) {
      var name = basename(path);
      var at = name.lastIndexOf(".");
      return at > 0 ? name.slice(at) : "";
    },
    relative: function (from, to) {
      var a = normalize(from).split("/").filter(Boolean);
      var b = normalize(to).split("/").filter(Boolean);
      var same = 0;
      while (same < a.length && same < b.length && a[same] === b[same]) same++;
      var up = a.slice(same).map(function () {
        return "..";
      });
      return up.concat(b.slice(same)).join("/") || ".";
    },
  };
})();

textus.appearance = {
  // Layered over the theme until disposed or the plugin stops.
  setColors: function (colors, options) {
    return call("appearance.setColors", {
      colors: plain(colors),
      scheme: (options && options.scheme) || "both",
    }).then(function (id) {
      return disposable(function () {
        quiet(call("appearance.clear", { id: id }));
      });
    });
  },
  colors: function () {
    return call("appearance.colors");
  },
  onDidChange: on("appearance"),
};

textus.app = {
  // Kept up to date from the first time it is read.
  get state() {
    if (!listeners.has("appState")) on("appState")(function () {});
    return env.appState || "active";
  },
  onDidChangeState: on("appState"),
  // The user typed (once typing pauses) or saved, nothing more.
  onDidActivity: on("activity"),
};
