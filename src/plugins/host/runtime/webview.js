// A webview's runtime: what a plugin's panel, view or editor page is given
// as `textus` (acquireTextusApi() returns the same), run before the
// plugin's HTML in the sandboxed frame (frames.ts). It talks to its own
// plugin's host only, through the window - as a VS Code webview does.
//
// Plain JavaScript, put into the frame as is.
/* global createEndpoint */
(function () {
  "use strict";
  var app = null;
  var queue = [];
  var receivers = new Set();
  var state = null;
  var exporter = null;

  // The page with everything it loads (its chart library) in, so a
  // picture asked for at once is not asked of a page still loading.
  var loaded = new Promise(function (resolve) {
    if (document.readyState === "complete") resolve();
    else window.addEventListener("load", resolve, { once: true });
  });

  function send(method, params) {
    if (app) app.notify(method, params);
    else queue.push([method, params]);
  }

  // The window's theme as CSS variables, kept current: a plugin's page
  // styled with var(--text), var(--bg) follows Textus's theme and dark
  // mode.
  function setTheme(css, dark) {
    var style = document.getElementById("textus-theme");
    if (!style) {
      style = document.createElement("style");
      style.id = "textus-theme";
      (document.head || document.documentElement).prepend(style);
    }
    style.textContent = css;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
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

  // The language and the plugin's strings, written into the page ahead of
  // this script (frames.ts), so the page's own scripts have them at once.
  var locale = { language: "", l10n: {} };
  try {
    locale = JSON.parse(document.getElementById("textus-locale").textContent);
  } catch {
    // A page made without them: English, and the keys.
  }
  var l10n = locale.l10n || {};

  var api = {
    // The UI's language, as Textus's settings have it ("zh", "en").
    language: locale.language || document.documentElement.lang || "en",
    // A string of the plugin's manifest in that language.
    t: function (key) {
      return localized(
        l10n,
        api.language,
        String(key),
        Array.prototype.slice.call(arguments, 1),
      );
    },
    postMessage: function (message) {
      send("message", { message: message });
    },
    onMessage: function (callback) {
      receivers.add(callback);
      return {
        dispose: function () {
          receivers.delete(callback);
        },
      };
    },
    // Kept by the window while the view is open, so a page rebuilt (its
    // tab moved, the theme changed) can pick up where it was.
    getState: function () {
      return state;
    },
    setState: function (value) {
      state = value;
      send("state", { state: value });
      return value;
    },
    // How the page looks as a picture, asked when the document is
    // exported: an SVG's markup or an image's data: URL.
    onExport: function (provider) {
      exporter = provider;
      return {
        dispose: function () {
          if (exporter === provider) exporter = null;
        },
      };
    },
  };

  window.addEventListener("message", function receive(event) {
    if (event.source !== window.parent || app) return;
    var data = event.data;
    if (!data || data.textus !== "init" || !event.ports[0]) return;
    window.removeEventListener("message", receive);
    state = data.state === undefined ? null : data.state;
    api.language = data.language || "en";
    app = createEndpoint(
      event.ports[0],
      {
        message: function (params) {
          receivers.forEach(function (receive) {
            receive(params.message);
          });
          // Also as a DOM event, as VS Code's webviews get them.
          window.dispatchEvent(
            new MessageEvent("message", { data: params.message }),
          );
        },
        theme: function (params) {
          setTheme(params.css, params.dark);
        },
        export: function (params) {
          return loaded.then(function () {
            return exporter ? exporter({ theme: params.theme }) : null;
          });
        },
      },
      0,
    );
    queue.splice(0).forEach(function (args) {
      app.notify(args[0], args[1]);
    });
  });

  // The page's height, for a frame that fits what it shows (a code block
  // drawn in the document): told when it changes.
  var told = -1;
  function tellHeight() {
    var height = Math.ceil(document.documentElement.scrollHeight);
    if (height === told) return;
    told = height;
    send("height", { height: height });
  }
  if (typeof ResizeObserver === "function")
    window.addEventListener("DOMContentLoaded", function () {
      new ResizeObserver(tellHeight).observe(document.documentElement);
      if (document.body) new ResizeObserver(tellHeight).observe(document.body);
    });

  window.textus = api;
  window.acquireTextusApi = function () {
    return api;
  };
  window.parent.postMessage({ textus: "ready" }, "*");
})();
