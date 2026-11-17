// A webview's runtime, first part (webview-runtime.ts joins the parts inside
// one function): the link to the window, the page's log and its menu.

var app = null;
var queue = [];
var receivers = new Set();
var held = [];
// Messages kept for a page that has no receiver yet.
var HELD = 50;
var state = null;
var visibility = new Set();
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

// A call that waits for the window, as send does.
var onConnected = null;
var connected = new Promise(function (resolve) {
  onConnected = resolve;
});
function call(method, params) {
  return connected.then(function () {
    return app.call(method, params);
  });
}

// The page's errors and console warnings go to the plugin's log, where
// its author looks (Settings › the plugin), not only to a devtools.
function logged(level, parts) {
  var text = Array.prototype.map
    .call(parts, function (part) {
      if (part instanceof Error) return part.stack || part.message;
      if (typeof part === "string") return part;
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .join(" ");
  send("log", { level: level, message: text.slice(0, 2000) });
}
["error", "warn"].forEach(function (level) {
  var own = console[level];
  console[level] = function () {
    logged(level, arguments);
    return own.apply(console, arguments);
  };
});
window.addEventListener("error", function (event) {
  logged("error", [event.error || event.message]);
});
window.addEventListener("unhandledrejection", function (event) {
  logged("error", [event.reason]);
});

// A press or Escape in the page closes the app's menu over it: the
// window can't see them, the page's events stay in its frame.
var menuOpen = false;
function closeMenu(event) {
  if (!menuOpen) return;
  if (event.type === "keydown" && event.key !== "Escape") return;
  menuOpen = false;
  send("menuClose", {});
}
window.addEventListener("pointerdown", closeMenu, true);
// A finger's press, which the window can't see either: a block shows its
// tools then (pressed-blocks.ts).
window.addEventListener(
  "pointerdown",
  function (event) {
    if (event.pointerType !== "mouse") send("pressed", {});
  },
  true,
);
window.addEventListener("keydown", closeMenu, true);
