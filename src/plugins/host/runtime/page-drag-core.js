// Pointer drags in a plugin page (`textus.drag`, API 1.7 and 1.12), by
// mouse or finger: the rules every drag in Textus keeps. A mouse drags once
// it moves 5 px; a finger once it has held still a moment (before that, a
// move is a scroll), and the page doesn't scroll under a lifted finger.
// Plain JavaScript, run after page-kit.js; page-drag.js builds the lists'
// drags on it.
(function () {
  "use strict";
  var START_PX = 5;
  // A finger: held still this long it lifts what it is on; moved further
  // first, it scrolls.
  var HOLD_MS = 300; // the app's hold-drag.ts
  var SLOP_PX = 10;
  // Near a scroller's edge the drag scrolls it, faster the further in, in
  // pixels a 60 Hz frame (edge-scroll.ts's pace). Raw pixels, not the
  // window's scaledPx: a plugin page has its own zoom.
  var EDGE = 36;
  var MAX_STEP = 40;
  var FRAME_MS = 1000 / 60;
  var LONGEST_GAP_MS = 50;
  // A scroller that snaps turns a page after the pointer rests this long.
  var FLIP_MS = 600;

  // A lifted finger's moves are the drag's, not the page's scroll.
  var lifted = false;
  window.addEventListener(
    "touchmove",
    function (e) {
      if (lifted && e.cancelable) e.preventDefault();
    },
    { passive: false },
  );

  // No text selected, no system menu, while a drag is coming or going on;
  // after it, the page's own settings again. All are read before any is
  // set: webkitUserSelect is userSelect in Chromium.
  var QUIETED = ["userSelect", "webkitUserSelect", "webkitTouchCallout"];
  var kept = null;
  function quiet(on) {
    var style = document.body.style;
    if (on === !!kept) return;
    if (on) {
      kept = QUIETED.map(function (name) {
        return style[name];
      });
      QUIETED.forEach(function (name) {
        style[name] = "none";
      });
      var selection = window.getSelection && window.getSelection();
      if (selection) selection.removeAllRanges();
    } else {
      for (var i = QUIETED.length - 1; i >= 0; i--) style[QUIETED[i]] = kept[i];
      kept = null;
    }
  }

  function swallow(e) {
    e.stopPropagation();
    e.preventDefault();
  }

  // The click a release sends lands on what was dragged: it isn't one.
  function swallowClick() {
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(function () {
      window.removeEventListener("click", swallow, true);
    }, 0);
  }

  // Follows a press from `down` (already a drag with `started`): start
  // once it moves START_PX, move, then end(x, y, dropped).
  function follow(down, handlers, started) {
    var from = { x: down.clientX, y: down.clientY };
    var last = { x: from.x, y: from.y };
    var dragging = false;
    var done = false;
    // A finger's events stay with the node it pressed, also once that node
    // leaves the page: they no longer reach the window.
    var origin = down.target instanceof Node ? down.target : null;
    var heard = new WeakSet();
    function once(handle) {
      return function (e) {
        if (e.pointerId !== undefined && e.pointerId !== down.pointerId) return;
        if (heard.has(e)) return;
        heard.add(e);
        handle(e);
      };
    }
    function begin() {
      dragging = true;
      lifted = true;
      quiet(true);
    }
    var move = once(function (e) {
      // A release WebView2 never told: the buttons are up.
      if (e.buttons === 0) return finish(e.clientX, e.clientY, true);
      last = { x: e.clientX, y: e.clientY };
      if (!dragging) {
        if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < START_PX)
          return;
        begin();
        // `start` answering false: what it would lift is gone.
        if (handlers.start && handlers.start(from.x, from.y) === false) {
          dragging = false;
          lifted = false;
          return finish(from.x, from.y, false);
        }
      }
      e.preventDefault();
      handlers.move(e.clientX, e.clientY, e);
    });
    var hold = function (e) {
      if (dragging && e.cancelable) e.preventDefault();
    };
    function finish(x, y, dropped) {
      if (done) return;
      done = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", lost);
      window.removeEventListener("pointerdown", pressed, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("contextmenu", noMenu, true);
      onOrigin.forEach(function (pair) {
        if (origin) origin.removeEventListener(pair[0], pair[1]);
      });
      quiet(false);
      if (!dragging) return;
      lifted = false;
      handlers.end(x, y, dropped);
      swallowClick();
    }
    var up = once(function (e) {
      finish(e.clientX, e.clientY, true);
    });
    var cancel = once(function (e) {
      finish(e.clientX, e.clientY, false);
    });
    // The window losing focus mid-drag (another app, another window) may
    // take the release with it: the drag ends, dropping nothing.
    function lost() {
      finish(last.x, last.y, false);
    }
    // A new press while this one is still followed: its release went
    // unheard, and the drag ends where it was, dropping nothing.
    function pressed() {
      finish(last.x, last.y, false);
    }
    function key(e) {
      if (e.key !== "Escape" || !dragging) return;
      e.preventDefault();
      e.stopPropagation();
      finish(from.x, from.y, false);
    }
    // A finger held still is a long press to Android's web view: neither
    // its menu nor the page's own takes the drag over.
    function noMenu(e) {
      e.preventDefault();
      if (dragging) e.stopPropagation();
    }
    var onOrigin = [
      ["pointermove", move],
      ["pointerup", up],
      ["pointercancel", cancel],
      ["touchmove", hold],
    ];
    if (started) begin();
    window.addEventListener("contextmenu", noMenu, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", lost);
    window.addEventListener("pointerdown", pressed, true);
    window.addEventListener("keydown", key, true);
    onOrigin.forEach(function (pair) {
      if (origin) origin.addEventListener(pair[0], pair[1], { passive: false });
    });
    return {
      cancel: function () {
        finish(last.x, last.y, false);
      },
    };
  }

  // A finger's press that lifts once it has held still HOLD_MS: start,
  // then move once it travels; let go without travelling, it ends dropping
  // nothing and was a long press (`held`). Moved first, or a second finger
  // down (a pinch), it is the page's.
  function holdThen(down, handlers) {
    var from = { x: down.clientX, y: down.clientY };
    var following = null;
    // Quiet while it holds: iOS would show its callout first.
    quiet(true);
    function stop(lifting) {
      clearTimeout(timer);
      window.removeEventListener("pointermove", moved);
      window.removeEventListener("pointerdown", other, true);
      window.removeEventListener("pointerup", gone);
      window.removeEventListener("pointercancel", gone);
      if (!lifting) quiet(false);
    }
    function moved(e) {
      if (e.pointerId !== down.pointerId) return;
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > SLOP_PX)
        stop(false);
    }
    function other(e) {
      if (e.pointerId !== down.pointerId) stop(false);
    }
    function gone(e) {
      if (e.pointerId === down.pointerId) stop(false);
    }
    var timer = setTimeout(function () {
      stop(true);
      var travelled = false;
      if (handlers.start && handlers.start(from.x, from.y) === false)
        return quiet(false);
      following = follow(
        down,
        {
          move: function (x, y, e) {
            travelled =
              travelled || Math.hypot(x - from.x, y - from.y) >= START_PX;
            if (travelled) handlers.move(x, y, e);
          },
          end: function (x, y, dropped) {
            handlers.end(x, y, travelled && dropped);
            if (!travelled && dropped && handlers.held) handlers.held(x, y);
          },
        },
        true,
      );
    }, HOLD_MS);
    window.addEventListener("pointermove", moved);
    window.addEventListener("pointerdown", other, true);
    window.addEventListener("pointerup", gone);
    window.addEventListener("pointercancel", gone);
    return {
      cancel: function () {
        stop(false);
        if (following) following.cancel();
      },
    };
  }

  // Follows a press from `down`: start, move, then end(x, y, dropped); the
  // click a drag's release sends is swallowed. `start` answering false
  // ends it there (what it would lift is gone). A finger holds first, unless
  // `options.hold` is false (a surface that takes every touch itself).
  function track(down, handlers, options) {
    if (down.button !== 0) return { cancel: function () {} };
    var hold =
      down.pointerType === "touch" && !(options && options.hold === false);
    return hold ? holdThen(down, handlers) : follow(down, handlers, false);
  }

  // Pixels a frame a pointer at `at` asks a scroller spanning lo..hi to
  // move: more the further into the edge band, up to MAX_STEP; negative
  // towards lo.
  function edgeStep(at, lo, hi) {
    var ramp = function (into) {
      return Math.min(MAX_STEP, Math.ceil(into / 3));
    };
    if (at > hi - EDGE) return ramp(at - (hi - EDGE));
    if (at < lo + EDGE) return -ramp(lo + EDGE - at);
    return 0;
  }

  function scrollsOn(el, axis) {
    var room =
      axis === "x"
        ? el.scrollWidth - el.clientWidth
        : el.scrollHeight - el.clientHeight;
    if (!(room > 0)) return false;
    if (el === document.scrollingElement) return true;
    var overflow =
      getComputedStyle(el)[axis === "x" ? "overflowX" : "overflowY"];
    return overflow === "auto" || overflow === "scroll";
  }

  function snaps(el, axis) {
    var type = (getComputedStyle(el).scrollSnapType || "none").split(" ")[0];
    return type === axis || type === "both";
  }

  // The pointer near the edge of what scrolls around a node scrolls it, on
  // either axis (`axes` limits it), and goes on while it rests there; a
  // scroller that snaps turns a page at a time instead. `scrolled()` after
  // each step that moved something.
  function edgeScroll(axes, scrolled) {
    var point = null;
    var frame = 0;
    var then = 0;
    var carry = { x: 0, y: 0 };
    var dwell = { x: null, y: null };
    function scrollerOf(node, axis) {
      for (var n = node; n && n.nodeType === 1; n = n.parentNode)
        if (scrollsOn(n, axis)) return n;
      var page = document.scrollingElement;
      return page && scrollsOn(page, axis) ? page : null;
    }
    function stepAxis(axis, now, gap) {
      var el = scrollerOf(point.node, axis);
      var page = el === document.scrollingElement;
      var r = el && el.getBoundingClientRect();
      var pace = !r
        ? 0
        : axis === "x"
          ? edgeStep(
              point.x,
              page ? 0 : Math.max(r.left, 0),
              page ? innerWidth : Math.min(r.right, innerWidth),
            )
          : edgeStep(
              point.y,
              page ? 0 : Math.max(r.top, 0),
              page ? innerHeight : Math.min(r.bottom, innerHeight),
            );
      if (!pace) {
        carry[axis] = 0;
        dwell[axis] = null;
        return false;
      }
      var sign = Math.sign(pace);
      if (snaps(el, axis)) {
        var d = dwell[axis];
        if (!d || d.el !== el || d.sign !== sign)
          dwell[axis] = { el: el, sign: sign, since: now };
        else if (now - d.since >= FLIP_MS) {
          var by = { behavior: "smooth" };
          by[axis === "x" ? "left" : "top"] =
            sign * (axis === "x" ? el.clientWidth : el.clientHeight);
          el.scrollBy(by);
          d.since = now;
        }
        return true;
      }
      // By time, so a 120 Hz screen scrolls no faster; less than a pixel's
      // share carries to the next frame.
      var want = (pace * gap) / FRAME_MS + carry[axis];
      var whole = Math.trunc(want);
      carry[axis] = want - whole;
      if (!whole) return true;
      var key = axis === "x" ? "scrollLeft" : "scrollTop";
      var before = el[key];
      el[key] = before + whole;
      if (el[key] === before) {
        carry[axis] = 0;
        return false;
      }
      if (scrolled) scrolled();
      return true;
    }
    function run(now) {
      frame = 0;
      var gap = then ? Math.min(now - then, LONGEST_GAP_MS) : FRAME_MS;
      then = now;
      var x = axes !== "y" && stepAxis("x", now, gap);
      var y = axes !== "x" && stepAxis("y", now, gap);
      if (x || y) frame = requestAnimationFrame(run);
      else then = 0;
    }
    return {
      at: function (x, y, node) {
        point = { x: x, y: y, node: node };
        if (!frame) frame = requestAnimationFrame(run);
      },
      stop: function () {
        cancelAnimationFrame(frame);
        frame = 0;
        then = 0;
      },
    };
  }

  // Where among `items` a pointer at `at` goes: before the first whose
  // middle it hasn't passed.
  function indexAt(items, at, axis) {
    for (var i = 0; i < items.length; i++) {
      var r = items[i].getBoundingClientRect();
      var middle = axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2;
      if (at < middle) return i;
    }
    return items.length;
  }

  window.textus.drag = {
    track: track,
    indexAt: indexAt,
    // page-drag.js's, not the API's.
    _edgeScroll: edgeScroll,
    _edgeStep: edgeStep,
    _EDGE: EDGE,
  };
})();
