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

  var api = {
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
  };

  window.addEventListener("message", function receive(event) {
    if (event.source !== window.parent || app) return;
    var data = event.data;
    if (!data || data.textus !== "init" || !event.ports[0]) return;
    window.removeEventListener("message", receive);
    state = data.state === undefined ? null : data.state;
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
      },
      0,
    );
    queue.splice(0).forEach(function (args) {
      app.notify(args[0], args[1]);
    });
  });

  window.textus = api;
  window.acquireTextusApi = function () {
    return api;
  };
  window.parent.postMessage({ textus: "ready" }, "*");
})();
