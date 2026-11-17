/* global __textusText */
// The tools a plugin page calls on `textus` (API 1.7): a list dragged into
// a new order, a popover under a button, a month and a date picker, a
// resize handle. Plain JavaScript, run after page-kit.js; the look is the
// window's CSS.
(function () {
  "use strict";
  var api = window.textus;
  var dates = __textusText.dates;
  var DRAG_START_PX = 5;

  // ---- A list dragged into a new order: the item lifts and follows the
  // pointer, the others make room as it passes them (the window's tabs'
  // way); let go, onDrop(from, to). Esc puts it back.
  function reorder(container, options) {
    var axis = options.axis === "x" ? "x" : "y";
    function down(event) {
      if (event.button !== 0) return;
      var grip = event.target instanceof Element ? event.target : null;
      if (options.handle && !(grip && grip.closest(options.handle))) return;
      var items = Array.prototype.slice.call(
        container.querySelectorAll(options.items),
      );
      var item = grip && grip.closest(options.items);
      var from = items.indexOf(item);
      if (from < 0) return;
      var start = axis === "x" ? event.clientX : event.clientY;
      var mid = function (el) {
        var r = el.getBoundingClientRect();
        return axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2;
      };
      var box = item.getBoundingClientRect();
      // In a zoomed page the screen's pixels aren't the item's: moves are
      // measured on screen and drawn in the item's own.
      var own = axis === "x" ? item.offsetWidth : item.offsetHeight;
      var scale = own > 0 ? (axis === "x" ? box.width : box.height) / own : 1;
      var size = (axis === "x" ? box.width : box.height) / scale;
      var others = items.filter(function (el) {
        return el !== item;
      });
      var centers = others.map(mid);
      var mine = mid(item);
      var to = from;
      var dragging = false;
      var translate = axis === "x" ? "translateX" : "translateY";
      function move(e) {
        var along = (axis === "x" ? e.clientX : e.clientY) - start;
        if (!dragging) {
          if (Math.abs(along) < DRAG_START_PX) return;
          dragging = true;
          item.classList.add("is-drag-lifted");
          document.body.style.userSelect = "none";
        }
        e.preventDefault();
        to = centers.filter(function (c) {
          return c < mine + along;
        }).length;
        item.style.transform = translate + "(" + along / scale + "px)";
        others.forEach(function (el, i) {
          var by =
            to > from && i >= from && i < to
              ? -size
              : to < from && i >= to && i < from
                ? size
                : 0;
          el.style.transition = "var(--move-make-room)";
          el.style.transform = by ? translate + "(" + by + "px)" : "";
        });
      }
      function end(dropped) {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key, true);
        if (!dragging) return;
        document.body.style.userSelect = "";
        item.classList.remove("is-drag-lifted");
        items.forEach(function (el) {
          el.style.transform = "";
          el.style.transition = "";
        });
        // The click a release sends is not one.
        window.addEventListener("click", swallow, {
          capture: true,
          once: true,
        });
        setTimeout(function () {
          window.removeEventListener("click", swallow, true);
        }, 0);
        if (!dropped || to === from) return;
        // In its new place at once: it stays there while the plugin saves
        // the order and draws again, instead of springing back first.
        var parent = item.parentNode;
        if (parent)
          parent.insertBefore(
            item,
            to > from ? items[to].nextSibling : items[to],
          );
        options.onDrop(from, to);
      }
      var up = function () {
        end(true);
      };
      var cancel = function () {
        end(false);
      };
      var key = function (e) {
        if (e.key !== "Escape" || !dragging) return;
        e.preventDefault();
        e.stopPropagation();
        end(false);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key, true);
    }
    container.addEventListener("pointerdown", down);
    return {
      dispose: function () {
        container.removeEventListener("pointerdown", down);
      },
    };
  }
  function swallow(event) {
    event.stopPropagation();
    event.preventDefault();
  }

  // ---- A popover: `content` in the window's floating surface under
  // `anchor` (above it with no room below), kept on screen; a press
  // outside it or Esc closes it, the focus going back to `anchor`.
  function popover(content, anchor, options) {
    var opts = options || {};
    var box = document.createElement("div");
    box.className = "tx-popover floating-surface";
    box.setAttribute("role", opts.role || "dialog");
    if (opts.label) box.setAttribute("aria-label", opts.label);
    box.appendChild(content);
    document.body.appendChild(box);
    function place() {
      var a = anchor.getBoundingClientRect();
      var own = box.getBoundingClientRect();
      var below = a.bottom + 6 + own.height <= window.innerHeight - 4;
      var left = opts.align === "end" ? a.right - own.width : a.left;
      box.style.left =
        Math.min(Math.max(4, left), window.innerWidth - own.width - 4) + "px";
      box.style.top =
        Math.max(4, below ? a.bottom + 6 : a.top - 6 - own.height) + "px";
    }
    place();
    var closedWith;
    var closed = new Promise(function (resolve) {
      closedWith = resolve;
    });
    function outside(event) {
      if (!box.contains(event.target) && !anchor.contains(event.target))
        close();
    }
    function key(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      anchor.focus();
    }
    var open = true;
    // Also once the page took the box away itself.
    function close(value) {
      if (!open) return;
      open = false;
      box.remove();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", place);
      closedWith(value === undefined ? null : value);
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", place);
    var first = box.querySelector(
      "button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    if (first) first.focus();
    return { element: box, close: close, closed: closed };
  }

  // ---- A month's days, from the week's first day where the language
  // starts its weeks (or `options.weekStart`, 0 Sunday … 6 Saturday):
  // { date: "YYYY-MM-DD", day, inMonth, today }.
  function iso(d) {
    return dates.format(d, "YYYY-MM-DD", api.language);
  }
  function monthDays(year, month, options) {
    var first = new Date(year, month, 1);
    // The language's first day, unless the page names one (a vault's).
    var given = options && options.weekStart;
    var start =
      given === undefined || given === null
        ? dates.weekStart(api.language)
        : given;
    var back = (first.getDay() - start + 7) % 7;
    var today = iso(new Date());
    var out = [];
    for (var i = 0; i < 42; i++) {
      var d = new Date(year, month, 1 - back + i);
      out.push({
        date: iso(d),
        day: d.getDate(),
        inMonth: d.getMonth() === month,
        today: iso(d) === today,
      });
    }
    return out;
  }

  // ---- A date picked on a month under `anchor`: "YYYY-MM-DD", or null.
  function pickDate(value, anchor) {
    var picked = value ? new Date(String(value) + "T00:00") : new Date();
    if (isNaN(picked.getTime())) picked = new Date();
    var shown = { year: picked.getFullYear(), month: picked.getMonth() };
    var chosen = value ? iso(picked) : null;
    var root = document.createElement("div");
    root.className = "tx-date-picker";
    var head = root.appendChild(document.createElement("div"));
    head.className = "tx-date-picker-head";
    var back = head.appendChild(document.createElement("button"));
    var title = head.appendChild(document.createElement("span"));
    var on = head.appendChild(document.createElement("button"));
    back.className = on.className = "tx-icon-button";
    back.textContent = "‹";
    on.textContent = "›";
    var grid = root.appendChild(document.createElement("div"));
    grid.className = "tx-calendar";
    grid.setAttribute("role", "grid");
    var pop;
    function draw() {
      title.textContent = dates.format(
        new Date(shown.year, shown.month, 1),
        "MMMM YYYY",
        api.language,
      );
      grid.textContent = "";
      monthDays(shown.year, shown.month).forEach(function (d) {
        var b = grid.appendChild(document.createElement("button"));
        b.className =
          "tx-calendar-day" +
          (d.inMonth ? "" : " is-other") +
          (d.today ? " is-today" : "");
        b.textContent = String(d.day);
        b.setAttribute("aria-label", d.date);
        b.setAttribute("aria-selected", String(d.date === chosen));
        b.tabIndex = d.date === (chosen || iso(new Date())) ? 0 : -1;
        b.addEventListener("click", function () {
          pop.close(d.date);
        });
      });
    }
    function turn(by) {
      var m = new Date(shown.year, shown.month + by, 1);
      shown = { year: m.getFullYear(), month: m.getMonth() };
      draw();
    }
    back.addEventListener("click", function () {
      turn(-1);
    });
    on.addEventListener("click", function () {
      turn(1);
    });
    grid.addEventListener("keydown", function (event) {
      var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[
        event.key
      ];
      var days = Array.prototype.slice.call(grid.children);
      var at = days.indexOf(document.activeElement);
      if (!step || at < 0 || !days[at + step]) return;
      event.preventDefault();
      days[at].tabIndex = -1;
      days[at + step].tabIndex = 0;
      days[at + step].focus();
    });
    draw();
    pop = popover(root, anchor, { label: title.textContent });
    var focus = grid.querySelector("[tabindex='0']");
    if (focus) focus.focus();
    return pop.closed;
  }

  // ---- A handle that resizes something by dragging, or by ←/→ (↑/↓):
  // `get()` the size now, `set(px)` while it moves, `done(px)` at the end.
  function resizeHandle(handle, options) {
    var axis = options.axis === "y" ? "y" : "x";
    var min = options.min || 0;
    var max = options.max || Infinity;
    var clamp = function (n) {
      return Math.min(max, Math.max(min, n));
    };
    handle.classList.add("tx-resize-handle");
    handle.setAttribute("role", "separator");
    handle.setAttribute(
      "aria-orientation",
      axis === "x" ? "vertical" : "horizontal",
    );
    if (!handle.hasAttribute("tabindex")) handle.tabIndex = 0;
    function down(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      var start = axis === "x" ? event.clientX : event.clientY;
      var from = options.get();
      var now = from;
      function move(e) {
        now = clamp(from + (axis === "x" ? e.clientX : e.clientY) - start);
        options.set(now);
      }
      function up() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (options.done) options.done(now);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    }
    function key(event) {
      var less = axis === "x" ? "ArrowLeft" : "ArrowUp";
      var more = axis === "x" ? "ArrowRight" : "ArrowDown";
      if (event.key !== less && event.key !== more) return;
      event.preventDefault();
      var next = clamp(options.get() + (event.key === more ? 16 : -16));
      options.set(next);
      if (options.done) options.done(next);
    }
    handle.addEventListener("pointerdown", down);
    handle.addEventListener("keydown", key);
    return {
      dispose: function () {
        handle.removeEventListener("pointerdown", down);
        handle.removeEventListener("keydown", key);
      },
    };
  }

  api.drag = { reorder: reorder };
  api.popover = popover;
  api.pickDate = pickDate;
  api.monthDays = monthDays;
  api.resizeHandle = resizeHandle;
})();
