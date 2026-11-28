// Lists dragged in a plugin page (`textus.drag`): one list into a new order
// (`reorder`, API 1.7), or an item among several lists (`sortable`, 1.12),
// on page-drag-core.js's pointer rules. Plain JavaScript, run after it.
(function () {
  "use strict";
  var drag = window.textus.drag;
  var track = drag.track;
  var indexAt = drag.indexAt;
  // The core's own parts, for these lists alone: off the API.
  var edgeScroll = drag._edgeScroll;
  var EDGE = drag._EDGE;
  delete drag._edgeScroll;
  delete drag._edgeStep;
  delete drag._EDGE;

  // A press here is the field's own: selecting its text, its menu.
  var FIELD =
    "textarea, select, [contenteditable]:not([contenteditable='false'])," +
    " input:not([type='checkbox']):not([type='radio']):not([type='button'])";

  // The window's motion, as Textus gives its pages: a duration, an ease.
  function motion() {
    var style = getComputedStyle(document.documentElement);
    var ms = parseFloat(style.getPropertyValue("--dur-base"));
    return {
      duration: isFinite(ms) ? ms : 200,
      easing: style.getPropertyValue("--ease-out").trim() || "ease-out",
    };
  }

  // ---- One list into a new order: the item lifts and follows the pointer,
  // the others make room as it passes them (the window's tabs' way); let
  // go, onDrop(from, to). Esc puts it back.
  function reorder(container, options) {
    var axis = options.axis === "x" ? "x" : "y";
    var pos = function (x, y) {
      return axis === "x" ? x : y;
    };
    var translate = axis === "x" ? "translateX" : "translateY";
    function down(event) {
      var grip = event.target instanceof Element ? event.target : null;
      if (options.handle && !(grip && grip.closest(options.handle))) return;
      if (grip && grip.closest(FIELD)) return;
      var item = grip && grip.closest(options.items);
      if (!item || !container.contains(item)) return;
      var items = Array.prototype.slice.call(
        container.querySelectorAll(options.items),
      );
      var from = items.indexOf(item);
      if (from < 0) return;
      var others = items.filter(function (el) {
        return el !== item;
      });
      var mid = function (el) {
        var r = el.getBoundingClientRect();
        return axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2;
      };
      var origin = 0;
      var pointer = 0;
      var to = from;
      var scale = 1;
      var size = 0;
      var centers = [];
      var mine = 0;
      // The scroll since the press counts: the items moved with it.
      var scroller = null;
      var scrollFrom = 0;
      var key = axis === "x" ? "scrollLeft" : "scrollTop";
      var scroll = edgeScroll(axis, place);
      function place() {
        var along =
          pointer - origin + (scroller ? scroller[key] - scrollFrom : 0);
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
      track(event, {
        start: function (x, y) {
          // Drawn anew while a finger held it: nothing to lift.
          if (!item.isConnected) return false;
          origin = pointer = pos(x, y);
          var box = item.getBoundingClientRect();
          // In a zoomed page the screen's pixels aren't the item's: moves
          // are measured on screen and drawn in the item's own.
          var own = axis === "x" ? item.offsetWidth : item.offsetHeight;
          var shown = axis === "x" ? box.width : box.height;
          scale = own > 0 ? shown / own : 1;
          size = shown / scale;
          centers = others.map(mid);
          mine = mid(item);
          for (var n = container; n && n.nodeType === 1; n = n.parentNode) {
            var room =
              axis === "x"
                ? n.scrollWidth > n.clientWidth
                : n.scrollHeight > n.clientHeight;
            var flow =
              getComputedStyle(n)[axis === "x" ? "overflowX" : "overflowY"];
            if (room && /auto|scroll/.test(flow)) {
              scroller = n;
              break;
            }
          }
          scroller = scroller || document.scrollingElement;
          scrollFrom = scroller ? scroller[key] : 0;
          item.classList.add("is-drag-lifted");
        },
        move: function (x, y) {
          pointer = pos(x, y);
          place();
          scroll.at(x, y, container);
        },
        end: function (_x, _y, dropped) {
          scroll.stop();
          item.classList.remove("is-drag-lifted");
          items.forEach(function (el) {
            el.style.transform = "";
            el.style.transition = "";
          });
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
        },
      });
    }
    container.addEventListener("pointerdown", down);
    return {
      dispose: function () {
        container.removeEventListener("pointerdown", down);
      },
    };
  }

  // The others slide from where they were to where they are now.
  function slide(nodes, before) {
    if (
      window.matchMedia &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    nodes.forEach(function (n) {
      var was = before.get(n);
      if (!was) return;
      var now = n.getBoundingClientRect();
      var dx = was.left - now.left;
      var dy = was.top - now.top;
      if (!dx && !dy) return;
      n.animate(
        [
          { transform: "translate(" + dx + "px," + dy + "px)" },
          { transform: "none" },
        ],
        motion(),
      );
    });
  }

  // ---- `item` dragged among the lists `lists()` gives, each holding its
  // items as `itemsOf(list)` gives them (`item` among them while it is
  // there), along `axis`. A copy follows the pointer while the item itself
  // moves through the lists in its place, so the others make way.
  // `onDrop(list, index)`: the list let go over and the index among its
  // items; `held(x, y)`: a finger lifted it and let go where it was.
  function sortable(down, options) {
    var item = options.item;
    var axis = options.axis === "x" ? "x" : "y";
    var home = { parent: item.parentNode, next: item.nextSibling };
    var ghost = null;
    var grab = { x: 0, y: 0 };
    // The page's own zoom: the pointer is in screen pixels, the ghost's
    // place in the page's.
    var scale = 1;
    var over = null;
    var last = null;
    var edges = edgeScroll("xy", scrolled);
    var finger = down.pointerType === "touch";
    function listAt(x, y) {
      var lists = options.lists();
      for (var i = 0; i < lists.length; i++) {
        var r = lists[i].getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
          return lists[i];
      }
      return null;
    }
    // Past the end of a short list (below a board's column): the nearest
    // list across whose span the pointer is.
    function listBeside(x, y) {
      var best = null;
      var far = Infinity;
      options.lists().forEach(function (l) {
        var r = l.getBoundingClientRect();
        var across =
          axis === "y"
            ? x >= r.left && x <= r.right
            : y >= r.top && y <= r.bottom;
        if (!across) return;
        var d =
          axis === "y"
            ? Math.max(r.top - y, y - r.bottom, 0)
            : Math.max(r.left - x, x - r.right, 0);
        if (d < far) {
          far = d;
          best = l;
        }
      });
      return best;
    }
    // The item to its place for a pointer at x, y. A finger at the
    // window's edge or past a short list counts for the list beside it.
    function place(x, y) {
      var list =
        listAt(x, y) ||
        (finger &&
          listBeside(
            Math.min(Math.max(x, EDGE), innerWidth - EDGE),
            Math.min(Math.max(y, EDGE), innerHeight - EDGE),
          ));
      if (!list) return;
      over = list;
      var rest = options.itemsOf(list).filter(function (n) {
        return n !== item;
      });
      var anchor = rest[indexAt(rest, axis === "x" ? x : y, axis)] || null;
      // Already there: nothing moves.
      if (
        item.parentNode === (anchor ? anchor.parentNode : list) &&
        item.nextSibling === anchor
      )
        return;
      var moving = options.lists().reduce(function (all, l) {
        return all.concat(options.itemsOf(l));
      }, []);
      var before = new Map();
      moving.forEach(function (n) {
        before.set(n, n.getBoundingClientRect());
      });
      if (anchor) anchor.parentNode.insertBefore(item, anchor);
      else if (rest.length) rest[rest.length - 1].after(item);
      else {
        // An empty list: before what follows its items (its add button).
        var end = options.after ? options.after(list) : null;
        if (end) end.parentNode.insertBefore(item, end);
        else list.append(item);
      }
      slide(moving, before);
    }
    // The lists moved under a pointer at rest: it is somewhere new.
    function scrolled() {
      if (last) place(last.x, last.y);
    }
    return track(down, {
      start: function (x, y) {
        var r = item.getBoundingClientRect();
        grab = { x: x - r.left, y: y - r.top };
        ghost = item.cloneNode(true);
        ghost.classList.add("tx-drag-ghost");
        // Its width with its padding and border, as the rect has it.
        ghost.style.boxSizing = "border-box";
        ghost.style.width = r.width + "px";
        document.body.append(ghost);
        scale = ghost.getBoundingClientRect().width / r.width || 1;
        ghost.style.width = r.width / scale + "px";
        // Measured: now it may grow, as everything dragged in Textus does.
        ghost.classList.add("is-lifted");
        ghost.style.left = r.left / scale + "px";
        ghost.style.top = r.top / scale + "px";
        item.classList.add("tx-drag-source");
        over = home.parent;
        window.addEventListener("scroll", scrolled, true);
      },
      move: function (x, y) {
        last = { x: x, y: y };
        ghost.style.left = (x - grab.x) / scale + "px";
        ghost.style.top = (y - grab.y) / scale + "px";
        place(x, y);
        edges.at(x, y, listAt(x, y) || over || home.parent);
      },
      end: function (_x, _y, dropped) {
        edges.stop();
        window.removeEventListener("scroll", scrolled, true);
        if (ghost) ghost.remove();
        item.classList.remove("tx-drag-source");
        var list = over;
        var index = list ? options.itemsOf(list).indexOf(item) : -1;
        if (!dropped || !list || index < 0) {
          home.parent.insertBefore(item, home.next);
          return;
        }
        options.onDrop(list, index);
      },
      held: options.held,
    });
  }

  drag.reorder = reorder;
  drag.sortable = sortable;
})();
