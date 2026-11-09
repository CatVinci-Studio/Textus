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
  window.addEventListener("keydown", closeMenu, true);

  // A pinch or a mod+wheel over the page zooms the document around it, as
  // it does anywhere else in the window: passed on, not kept here.
  window.addEventListener(
    "wheel",
    function (event) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      send("zoomWheel", {
        deltaY: event.deltaY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        x: event.clientX,
        y: event.clientY,
      });
    },
    { passive: false },
  );
  // No engine menu on a page, as in the window. A text field gets Textus's
  // own (undo, cut, copy, paste, select all), drawn by the window and done
  // here; a right-click the page itself didn't answer goes to the window,
  // whose menu has what it can do to the page there (a block's: delete it).
  window.addEventListener("contextmenu", function (event) {
    var target = event.target;
    var field =
      target && target.closest
        ? target.closest("input, textarea, [contenteditable='true']")
        : null;
    if (field && !event.defaultPrevented) {
      event.preventDefault();
      textMenu(field, event.clientX, event.clientY);
      return;
    }
    if (!event.defaultPrevented && !field)
      send("contextMenu", { x: event.clientX, y: event.clientY });
    event.preventDefault();
  });
  function selectedIn(field) {
    if ("selectionStart" in field && field.selectionStart !== null)
      return field.selectionStart !== field.selectionEnd;
    var selection = window.getSelection();
    return !!selection && !selection.isCollapsed;
  }
  function selectedText(field) {
    if ("selectionStart" in field && field.selectionStart !== null)
      return field.value.slice(field.selectionStart, field.selectionEnd);
    return String(window.getSelection() || "");
  }
  // While the menu is open the field is marked (data-menu-open): its blur
  // then isn't the end of an edit.
  function textMenu(field, x, y) {
    menuOpen = true;
    field.setAttribute("data-menu-open", "");
    call("textMenu", { x: x, y: y, selected: selectedIn(field) }).then(
      function (action) {
        menuOpen = false;
        field.focus();
        field.removeAttribute("data-menu-open");
        return editText(field, action);
      },
    );
  }
  /** Undo, redo, cut, copy, paste or select all in `field`, the clipboard
   *  through the window (a page can't read it). */
  function editText(field, action) {
    if (!action) return Promise.resolve();
    field.focus();
    return Promise.resolve().then(function () {
      if (action === "copy" || action === "cut") {
        var text = selectedText(field);
        return call("clipboardWrite", { text: text }).then(function () {
          if (action === "cut") document.execCommand("delete");
        });
      }
      if (action === "paste")
        return call("clipboardRead", {}).then(function (text) {
          if (text) document.execCommand("insertText", false, String(text));
        });
      if (action === "selectAll") {
        if (field.select) field.select();
        else document.execCommand("selectAll");
        return;
      }
      document.execCommand(action);
    });
  }
  ["gesturestart", "gesturechange", "gestureend"].forEach(function (type) {
    window.addEventListener(type, function (event) {
      event.preventDefault();
      send("zoomGesture", {
        type: type,
        scale: event.scale,
        x: event.clientX,
        y: event.clientY,
      });
    });
  });

  // Where a menu opens: under an element, or at a point of the page.
  function anchor(at) {
    if (at && typeof at.getBoundingClientRect === "function") {
      var box = at.getBoundingClientRect();
      return { x: box.left, y: box.bottom };
    }
    return { x: (at && at.x) || 0, y: (at && at.y) || 0 };
  }

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

  // A string of the plugin's manifest (`l10n`) in the UI's language: its
  // own, then its base language's ("zh-Hant" -> "zh"), then English, then
  // any language that has it, then the key. "{0}", "{1}"... are the
  // arguments after it.
  function localized(l10n, language, key, args) {
    var base = String(language).split("-")[0];
    var text =
      (l10n[language] && l10n[language][key]) ||
      (l10n[base] && l10n[base][key]) ||
      (l10n.en && l10n.en[key]) ||
      anyLanguage(l10n, key) ||
      key;
    return text.replace(/\{(\d+)\}/g, function (all, n) {
      return args[n] === undefined ? all : String(args[n]);
    });
  }

  function anyLanguage(l10n, key) {
    for (var language in l10n)
      if (l10n[language] && l10n[language][key]) return l10n[language][key];
    return undefined;
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
    for (var i = 0; i < body.children.length; i++) {
      var child = body.children[i];
      var style = getComputedStyle(child);
      if (style.display === "none" || style.position === "fixed") continue;
      bottom = Math.max(
        bottom,
        child.getBoundingClientRect().bottom +
          (parseFloat(style.marginBottom) || 0),
      );
    }
    return (
      bottom +
      (parseFloat(getComputedStyle(body).paddingBottom) || 0) +
      window.scrollY
    );
  }
  function tellHeight() {
    var height = Math.ceil(contentHeight());
    if (height === told) return;
    told = height;
    send("height", { height: height });
  }
  var pending = false;
  function soon() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      tellHeight();
      contain();
    });
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
  if (typeof ResizeObserver === "function")
    window.addEventListener("DOMContentLoaded", function () {
      new ResizeObserver(soon).observe(document.documentElement);
      if (document.body) {
        new ResizeObserver(soon).observe(document.body);
        // Content that shrinks leaves the body, held to the frame, as tall.
        new MutationObserver(soon).observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
      }
    });

  window.textus = api;
  window.acquireTextusApi = function () {
    return api;
  };
  window.parent.postMessage({ textus: "ready" }, "*");
})();
