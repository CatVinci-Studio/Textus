// A list in a plugin page dragged into a new order (`textus.drag`, API
// 1.7), by mouse or finger. Plain JavaScript, run after page-kit.js.
(function () {
  "use strict";
  var DRAG_START_PX = 5;
  // A finger: held still this long it lifts the item; moved further first,
  // it scrolls.
  var HOLD_MS = 500;
  var TOUCH_SLOP_PX = 10;
  // Near the scroller's edge the drag scrolls it, faster the further in
  // (edge-scroll.ts's pace).
  var EDGE_PX = 36;
  var EDGE_MAX_STEP = 40;

  // ---- A list dragged into a new order: the item lifts and follows the
  // pointer, the others make room as it passes them (the window's tabs'
  // way); let go, onDrop(from, to). Esc puts it back. A mouse drags once it
  // moves; a finger once it has held still, the page kept from scrolling
  // under it then.
  function reorder(container, options) {
    var axis = options.axis === "x" ? "x" : "y";
    function down(event) {
      if (event.button !== 0) return;
      var grip = event.target instanceof Element ? event.target : null;
      if (options.handle && !(grip && grip.closest(options.handle))) return;
      var item = grip && grip.closest(options.items);
      if (!item || !container.contains(item)) return;
      if (event.pointerType === "touch") holdToLift(event, start);
      else start(event, false);
    }
    function start(event, lifted) {
      var items = Array.prototype.slice.call(
        container.querySelectorAll(options.items),
      );
      var item = event.target.closest(options.items);
      var from = items.indexOf(item);
      if (from < 0) return quiet(false);
      var pos = function (e) {
        return axis === "x" ? e.clientX : e.clientY;
      };
      var origin = pos(event);
      var pointer = origin;
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
      var scroll = edgeScroll(container, axis, function () {
        place();
      });
      function lift() {
        dragging = true;
        item.classList.add("is-drag-lifted");
        pinned = true;
        quiet(true);
      }
      // Where the pointer is along the list, the scroll since the press
      // counted: the items moved with it.
      function place() {
        var along = pointer - origin + scroll.moved();
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
      function move(e) {
        if (e.pointerId !== event.pointerId) return;
        pointer = pos(e);
        if (!dragging) {
          if (Math.abs(pointer - origin) < DRAG_START_PX) return;
          lift();
        }
        e.preventDefault();
        place();
        scroll.at(e.clientX, e.clientY);
      }
      function end(dropped) {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key, true);
        pinned = false;
        scroll.stop();
        if (!dragging) return;
        quiet(false);
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
      var up = function (e) {
        if (e.pointerId === event.pointerId) end(true);
      };
      var cancel = function (e) {
        if (e.pointerId === event.pointerId) end(false);
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
      if (lifted) lift();
    }
    // Once lifted, a finger's move drags and the page doesn't pan. Held
    // on the list from the start: one added mid-touch may come too late
    // for the web view to wait on it.
    var pinned = false;
    function pin(e) {
      if (pinned && e.cancelable) e.preventDefault();
    }
    container.addEventListener("pointerdown", down);
    container.addEventListener("touchmove", pin, { passive: false });
    return {
      dispose: function () {
        container.removeEventListener("pointerdown", down);
        container.removeEventListener("touchmove", pin);
      },
    };
  }

  // No text selected, no system menu, while a drag is coming or going on.
  function quiet(on) {
    var style = document.body.style;
    style.userSelect = style.webkitUserSelect = on ? "none" : "";
    style.webkitTouchCallout = on ? "none" : "";
    if (on) window.addEventListener("contextmenu", swallow, true);
    else window.removeEventListener("contextmenu", swallow, true);
  }

  // A finger's press that lifts what it is on once held still HOLD_MS:
  // moved before that, or a second finger down, it is the page's.
  function holdToLift(down, lift) {
    quiet(true);
    var timer = setTimeout(function () {
      stop(true);
      lift(down, true);
    }, HOLD_MS);
    function moved(e) {
      if (e.pointerId !== down.pointerId) return;
      var dx = e.clientX - down.clientX;
      var dy = e.clientY - down.clientY;
      if (Math.hypot(dx, dy) > TOUCH_SLOP_PX) stop(false);
    }
    function other(e) {
      if (e.pointerId !== down.pointerId) stop(false);
    }
    function gone(e) {
      if (e.pointerId === down.pointerId) stop(false);
    }
    // `lifting`: the drag takes the quiet over and ends it.
    function stop(lifting) {
      clearTimeout(timer);
      window.removeEventListener("pointermove", moved);
      window.removeEventListener("pointerdown", other, true);
      window.removeEventListener("pointerup", gone);
      window.removeEventListener("pointercancel", gone);
      if (!lifting) quiet(false);
    }
    window.addEventListener("pointermove", moved);
    window.addEventListener("pointerdown", other, true);
    window.addEventListener("pointerup", gone);
    window.addEventListener("pointercancel", gone);
  }

  // What a drag near the list's scroller's edge scrolls, and by how much
  // so far; `moved()` is called again each frame it scrolls.
  function edgeScroll(container, axis, scrolled) {
    var scroller = scrollerOf(container, axis);
    var page = scroller === document.scrollingElement;
    var key = axis === "x" ? "scrollLeft" : "scrollTop";
    var from = scroller[key];
    var at = 0;
    var frame = 0;
    function pace() {
      var r = page
        ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
        : scroller.getBoundingClientRect();
      var lo = axis === "x" ? r.left : r.top;
      var hi = axis === "x" ? r.right : r.bottom;
      var ramp = function (into) {
        return Math.min(EDGE_MAX_STEP, Math.ceil(into / 3));
      };
      if (at > hi - EDGE_PX) return ramp(at - (hi - EDGE_PX));
      if (at < lo + EDGE_PX) return -ramp(lo + EDGE_PX - at);
      return 0;
    }
    // The pace is per 60 Hz frame; it goes by time, so a 120 Hz screen
    // scrolls no faster.
    var then = 0;
    function run(now) {
      frame = 0;
      var step = pace();
      var gap = then ? Math.min(now - then, 50) : 1000 / 60;
      then = step ? now : 0;
      if (!step) return;
      var before = scroller[key];
      scroller[key] = before + Math.round((step * gap * 60) / 1000);
      if (scroller[key] === before) {
        then = 0;
        return;
      }
      scrolled();
      frame = requestAnimationFrame(run);
    }
    return {
      at: function (x, y) {
        at = axis === "x" ? x : y;
        if (!frame) frame = requestAnimationFrame(run);
      },
      moved: function () {
        return scroller[key] - from;
      },
      stop: function () {
        cancelAnimationFrame(frame);
        frame = 0;
        then = 0;
      },
    };
  }
  function scrollerOf(el, axis) {
    var overflow = axis === "x" ? "overflowX" : "overflowY";
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      var room =
        axis === "x"
          ? n.scrollWidth > n.clientWidth
          : n.scrollHeight > n.clientHeight;
      if (room && /auto|scroll/.test(getComputedStyle(n)[overflow])) return n;
    }
    return document.scrollingElement || document.documentElement;
  }
  function swallow(event) {
    event.stopPropagation();
    event.preventDefault();
  }

  window.textus.drag = { reorder: reorder };
})();
