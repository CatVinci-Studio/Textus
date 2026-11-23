// A webview's runtime, last part: the theme and words, the `textus` a page is
// given, its height and its links.

// The window's theme as CSS variables, kept current: a plugin's page
// styled with var(--ui-text), var(--ui-bg) follows Textus's theme and dark
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

// localized(l10n, language, key, args): the frame is given it
// (plugin-string.ts).

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
  // onDidReceiveMessage (1.7) as host.js's webview names it; onMessage
  // stays for older pages.
  onMessage: function (callback) {
    return api.onDidReceiveMessage(callback);
  },
  onDidReceiveMessage: function (callback) {
    receivers.add(callback);
    held.splice(0).forEach(function (message) {
      callback(message);
    });
    return {
      dispose: function () {
        receivers.delete(callback);
      },
    };
  },
  // Whether the page is in sight. Out of sight it may be let go to save
  // memory, and is rebuilt when shown: what it should keep, it sets with
  // setState as it goes out of sight (onDidChangeVisibility).
  visible: true,
  onDidChangeVisibility: function (callback) {
    visibility.add(callback);
    return {
      dispose: function () {
        visibility.delete(callback);
      },
    };
  },
  // Kept by the window while the view is open, so a page rebuilt (its
  // tab moved, the theme changed, let go out of sight) can pick up where
  // it was.
  getState: function () {
    return state;
  },
  setState: function (value) {
    state = value;
    send("state", { state: value });
    return value;
  },
  // Textus's own menu over the page - its look, keys and motion - for a
  // right-click or a dropdown. Items: { label, value, checked, danger,
  // disabled }, "separator", or { label, items } for a submenu. Gives
  // the chosen item's value (its label without one), or null.
  // A text field's actions, for a page that puts them in a menu of its
  // own: textItems(field) gives them labelled in Textus's language (as
  // menu items, value the action), editText(field, action) does one.
  textItems: function (field) {
    return call("textItems", { selected: selectedIn(field) });
  },
  editText: function (field, action) {
    return editText(field, action);
  },
  menu: function (items, at) {
    var point = anchor(at);
    menuOpen = true;
    return call("menu", { items: items, x: point.x, y: point.y }).then(
      function (choice) {
        menuOpen = false;
        return choice;
      },
    );
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
        // Before the page listens, kept for its first listener; a page
        // that listens only for DOM messages keeps no more than a few.
        if (!receivers.size && held.push(params.message) > HELD) held.shift();
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
      visible: function (params) {
        if (api.visible === !!params.visible) return;
        api.visible = !!params.visible;
        visibility.forEach(function (callback) {
          callback(api.visible);
        });
      },
      // A page drawn in the document takes the document's zoom itself:
      // its frame is kept out of the window's, so it draws sharp.
      zoom: function (params) {
        document.documentElement.style.zoom =
          params.zoom === 1 ? "" : String(params.zoom);
      },
      export: function (params) {
        return loaded.then(function () {
          return exporter ? exporter({ theme: params.theme }) : null;
        });
      },
    },
    0,
  );
  onConnected();
  queue.splice(0).forEach(function (args) {
    app.notify(args[0], args[1]);
  });
});

// The page's height, for a frame that fits what it shows (a code block
// drawn in the document): told when it changes. Measured by where its
// content ends, not by the page's scroll height: the page is never
// shorter than its frame (and a first margin pushes it past), so a frame
// sized by that only ever grows.
var told = -1;
function contentHeight() {
  var body = document.body;
  if (!body) return document.documentElement.scrollHeight;
  var bottom = 0;
  var drawn = false;
  for (var i = 0; i < body.children.length; i++) {
    var child = body.children[i];
    var style = getComputedStyle(child);
    if (style.display === "none" || style.position === "fixed") continue;
    if (child.getBoundingClientRect().height > 0) drawn = true;
    bottom = Math.max(
      bottom,
      child.getBoundingClientRect().bottom +
        (parseFloat(style.marginBottom) || 0),
    );
  }
  // Nothing drawn yet: no height, or a frame opened at its last height
  // shrank to nothing for a moment and grew back.
  if (!drawn) return -1;
  return (
    bottom +
    (parseFloat(getComputedStyle(body).paddingBottom) || 0) +
    window.scrollY
  );
}
function tellHeight() {
  var height = Math.ceil(contentHeight());
  if (height < 0 || height === told) return;
  told = height;
  send("height", { height: height });
}
// Once a frame: or after a moment, as a frame not yet on screen may hold
// its animation frames back, and every later change would wait on it.
var pending = false;
function soon() {
  if (pending) return;
  pending = true;
  var done = false;
  var run = function () {
    if (done) return;
    done = true;
    pending = false;
    tellHeight();
    contain();
  };
  requestAnimationFrame(run);
  setTimeout(run, 100);
}
// A page taller than its frame scrolls in it, and its scrolling stops at
// its ends instead of carrying on into the document around it. One that
// fits passes the wheel on, as the rest of the document does.
function contain() {
  var root = document.documentElement;
  // By where the content ends: the page is never shorter than its frame.
  var scrolls = contentHeight() > window.innerHeight + 1;
  root.style.overscrollBehaviorY = scrolls ? "contain" : "";
}
window.addEventListener("resize", soon);
// Watched from when the page is parsed - at once if it already is - and
// told once then, as nothing may change after.
function watchSize() {
  soon();
  if (typeof ResizeObserver !== "function") return;
  new ResizeObserver(soon).observe(document.documentElement);
  if (!document.body) return;
  new ResizeObserver(soon).observe(document.body);
  // Content that shrinks leaves the body, held to the frame, as tall:
  // what comes and goes is enough to look again (a size change is the
  // observers' above), not every attribute an animation sets.
  new MutationObserver(soon).observe(document.body, {
    childList: true,
    subtree: true,
  });
}
if (document.readyState === "loading")
  window.addEventListener("DOMContentLoaded", watchSize);
else watchSize();

// A link never takes the page away: a web link opens in the browser.
document.addEventListener("click", function (event) {
  var link = event.target instanceof Element && event.target.closest("a[href]");
  if (!link || event.defaultPrevented) return;
  var href = link.getAttribute("href") || "";
  if (href.charAt(0) === "#") return;
  event.preventDefault();
  call("openLink", { url: link.href });
});

window.textus = api;
window.acquireTextusApi = function () {
  return api;
};
window.parent.postMessage(
  { textus: "ready", key: "__TEXTUS_FRAME_KEY__" },
  "*",
);
