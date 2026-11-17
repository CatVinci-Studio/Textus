/* global __textusText */
// What every plugin page gets from Textus without writing it (API 1.7):
// strings by data-t, the app's tooltips, arrow keys in a switch or a list,
// a bar that gives way as it narrows, and `textus.dates`. Plain
// JavaScript, run after webview.js; page-tools.js adds the tools a page
// calls. The look is the window's CSS.
(function () {
  "use strict";
  var api = window.textus;
  var dates = __textusText.dates;
  var TOOLTIP_MS = 500;

  // ---- Strings: [data-t] its text, [data-t-label] its name (and tooltip).
  function translate(root) {
    if (!root.querySelectorAll) return;
    root.querySelectorAll("[data-t]").forEach(function (el) {
      el.textContent = api.t(el.getAttribute("data-t"));
    });
    root.querySelectorAll("[data-t-label]").forEach(function (el) {
      var name = api.t(el.getAttribute("data-t-label"));
      el.setAttribute("aria-label", name);
      el.setAttribute("data-tooltip", name);
    });
  }

  // ---- Tooltips: [data-tooltip] (a title becomes one) in the app's look.
  var tip = null;
  var tipTimer = 0;
  function hideTip() {
    clearTimeout(tipTimer);
    if (tip) tip.remove();
    tip = null;
  }
  function showTip(el) {
    hideTip();
    var text = el.getAttribute("data-tooltip");
    if (!text) return;
    tip = document.createElement("div");
    tip.className = "tooltip floating-surface";
    tip.setAttribute("role", "tooltip");
    tip.textContent = text;
    document.body.appendChild(tip);
    var box = el.getBoundingClientRect();
    var own = tip.getBoundingClientRect();
    var below = box.bottom + 6 + own.height <= window.innerHeight;
    var left = Math.min(
      Math.max(4, box.left + box.width / 2 - own.width / 2),
      window.innerWidth - own.width - 4,
    );
    tip.style.left = left + "px";
    tip.style.top = (below ? box.bottom + 6 : box.top - 6 - own.height) + "px";
  }
  function tipTarget(event) {
    var el = event.target instanceof Element ? event.target : null;
    el = el && el.closest("[data-tooltip], [title]");
    if (el && el.hasAttribute("title")) {
      el.setAttribute("data-tooltip", el.getAttribute("title"));
      if (!el.hasAttribute("aria-label") && !el.textContent.trim())
        el.setAttribute("aria-label", el.getAttribute("title"));
      el.removeAttribute("title");
    }
    return el;
  }
  document.addEventListener("pointerover", function (event) {
    if (event.pointerType !== "mouse") return;
    var el = tipTarget(event);
    hideTip();
    if (el)
      tipTimer = setTimeout(function () {
        showTip(el);
      }, TOOLTIP_MS);
  });
  document.addEventListener("focusin", function (event) {
    var el = tipTarget(event);
    if (el && el.matches(":focus-visible")) showTip(el);
  });
  ["pointerout", "pointerdown", "focusout", "scroll", "keydown"].forEach(
    function (type) {
      document.addEventListener(type, hideTip, true);
    },
  );

  // ---- Arrow keys: a switch or tab row (.tx-segmented, role=tablist) is one
  // tab stop, ←/→ choosing; a list (role=listbox, role=menu) ↑/↓ moving.
  var ROWS = ".tx-segmented, [role='tablist']";
  var COLUMNS = "[role='listbox'], [role='menu']";
  var ITEMS =
    ":scope > :is(button, [role='tab'], [role='option'], [role='menuitem'], [role='radio']):not(:disabled)";
  // A row of tabs is its tabs: a button beside them ("+", a menu) is
  // reached with Tab, never chosen by the arrows.
  var TAB_ITEMS = ":scope > [role='tab']:not([aria-disabled='true'])";
  function chosen(item) {
    return (
      item.getAttribute("aria-selected") === "true" ||
      item.getAttribute("aria-checked") === "true" ||
      item.classList.contains("is-selected")
    );
  }
  function roving(group) {
    var tabs = group.querySelector(":scope > [role='tab']");
    var items = Array.prototype.slice.call(
      group.querySelectorAll(tabs ? TAB_ITEMS : ITEMS),
    );
    var at = items.findIndex(chosen);
    items.forEach(function (item, i) {
      item.tabIndex = i === (at < 0 ? 0 : at) ? 0 : -1;
    });
    return items;
  }
  function rovingAll(root) {
    if (root.querySelectorAll)
      root.querySelectorAll(ROWS + ", " + COLUMNS).forEach(roving);
  }
  document.addEventListener("keydown", function (event) {
    var target = event.target instanceof Element ? event.target : null;
    var group = target && target.parentElement;
    if (!group || event.defaultPrevented) return;
    var row = group.matches(ROWS);
    if (!row && !group.matches(COLUMNS)) return;
    var step = {
      ArrowLeft: row ? -1 : 0,
      ArrowRight: row ? 1 : 0,
      ArrowUp: row ? 0 : -1,
      ArrowDown: row ? 0 : 1,
    }[event.key];
    var items = roving(group);
    var at = items.indexOf(target);
    var next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : step
            ? (at + step + items.length) % items.length
            : -1;
    if (next < 0 || at < 0) return;
    event.preventDefault();
    items[next].focus();
    // A switch chooses as the arrows move, as the app's do.
    if (row) items[next].click();
  });

  // ---- A bar that gives way: data-fit-steps="tight tighter …", looser to
  // tighter; data-fit is the first step at which nothing in it overflows
  // or is cut (a label shown shorter than it is).
  function cut(bar) {
    return Array.prototype.some.call(
      bar.querySelectorAll(".tx-segment-label, [data-fit-label]"),
      function (label) {
        return label.scrollWidth > label.clientWidth + 1;
      },
    );
  }
  function fit(bar) {
    var steps = [""].concat(
      (bar.getAttribute("data-fit-steps") || "").split(/\s+/).filter(Boolean),
    );
    for (var i = 0; i < steps.length; i++) {
      bar.setAttribute("data-fit", steps[i]);
      if (bar.scrollWidth <= bar.clientWidth + 1 && !cut(bar)) return;
    }
  }
  var fitting = new WeakSet();
  var resized =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(function (entries) {
          entries.forEach(function (entry) {
            var bar = entry.target.matches("[data-fit-steps]")
              ? entry.target
              : entry.target.querySelector(":scope > [data-fit-steps]");
            if (bar) fit(bar);
          });
        })
      : null;
  function fitAll(root) {
    if (!root.querySelectorAll) return;
    root.querySelectorAll("[data-fit-steps]").forEach(function (bar) {
      fit(bar);
      if (fitting.has(bar) || !resized) return;
      fitting.add(bar);
      resized.observe(bar);
      if (bar.parentElement) resized.observe(bar.parentElement);
    });
  }

  function settle(roots) {
    roots.forEach(function (root) {
      translate(root);
      rovingAll(root);
    });
    fitAll(document);
  }
  function watch() {
    settle([document]);
    // Each parent once, however many children it was given.
    new MutationObserver(function (records) {
      var roots = new Set();
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) roots.add(node.parentElement || node);
        });
      });
      // A parent inside another one is read with it.
      var outer = [];
      roots.forEach(function (root) {
        var inside = false;
        roots.forEach(function (other) {
          if (other !== root && other.contains(root)) inside = true;
        });
        if (!inside) outer.push(root);
      });
      if (outer.length) settle(outer);
    }).observe(document.body, { childList: true, subtree: true });
    if (document.fonts) document.fonts.ready.then(fitAll.bind(null, document));
  }
  if (document.readyState === "loading")
    window.addEventListener("DOMContentLoaded", watch);
  else watch();

  // A scroller marked tx-scroll-fade (a board's lists, a wide table) fades
  // at an edge with more past it (controls.css), so it reads as going on.
  function edge(el) {
    el.toggleAttribute("data-more-left", el.scrollLeft > 1);
    el.toggleAttribute(
      "data-more-right",
      el.scrollWidth - el.clientWidth - el.scrollLeft > 1,
    );
  }
  function edges() {
    document.querySelectorAll(".tx-scroll-fade").forEach(edge);
  }
  // A scroll moves only its own scroller's edges, and shows its bars until
  // it rests (plugin-ui.css), as a page of Textus's does
  // (engine/controls/scroll-reveal.ts): WebKit's own overlay bars in a frame
  // can stay up after a scroll.
  var resting = new WeakMap();
  document.addEventListener(
    "scroll",
    function (event) {
      var el =
        event.target === document ? document.documentElement : event.target;
      if (!(el instanceof Element)) return;
      if (el.classList.contains("tx-scroll-fade")) edge(el);
      el.classList.add("is-scrolling");
      clearTimeout(resting.get(el));
      resting.set(
        el,
        setTimeout(function () {
          el.classList.remove("is-scrolling");
        }, 900),
      );
    },
    { capture: true, passive: true },
  );
  window.addEventListener("resize", edges);
  window.addEventListener("DOMContentLoaded", function () {
    edges();
    new MutationObserver(edges).observe(document.body, {
      childList: true,
      subtree: true,
    });
  });

  // As textus.dates in the plugin's host code: a Date, ms or "YYYY-MM-DD";
  // the language as { language } or, as the engine takes it, a string.
  function asDate(value) {
    var at =
      value instanceof Date
        ? value
        : typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? new Date(value + "T00:00:00")
          : new Date(value === undefined ? Date.now() : value);
    if (isNaN(at.getTime())) throw new Error("Not a date: " + value);
    return at;
  }
  function languageOf(options) {
    if (typeof options === "string") return options;
    return (options && options.language) || api.language || "en";
  }
  api.dates = {
    format: function (date, form, options) {
      return dates.format(
        asDate(date),
        form || "YYYY-MM-DD",
        languageOf(options),
      );
    },
    parse: function (text, form, options) {
      return dates.parse(
        String(text),
        form || "YYYY-MM-DD",
        languageOf(options),
      );
    },
  };
})();
