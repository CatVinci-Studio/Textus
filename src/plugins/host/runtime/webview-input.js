// A webview's runtime: zooming, the text-field menu and pinches, and where
// a menu opens.

// A pinch or a mod+wheel over the page zooms the document around it, as
// it does anywhere else in the window: passed on, not kept here, unless
// the page zoomed itself (a PDF). A scroll still moving when the key goes
// down stays a scroll (useZoom.ts).
var lastScroll = -Infinity;
var synthetic = false;
var pinch = null;
window.addEventListener(
  "wheel",
  function (event) {
    if (synthetic) return;
    // A pinch's own ctrl+wheel twin, where the engine sends one: the
    // page takes it or the pinch's gesture events zoom the document.
    if (pinch && event.ctrlKey) {
      pinch.twins = true;
      if (event.defaultPrevented) pinch.owner = pinch.owner || "page";
      else event.preventDefault();
      return;
    }
    if (event.defaultPrevented) return;
    var modified = event.ctrlKey || event.metaKey;
    if (!modified || event.timeStamp - lastScroll < 250) {
      lastScroll = event.timeStamp;
      return;
    }
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
      // Cut takes the text away only once it is on the clipboard.
      return call("clipboardWrite", { text: text }).then(function (ok) {
        if (action === "cut" && ok) document.execCommand("delete");
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
// A trackpad pinch in WebKit comes as gesture events, which pages rarely
// know: each step is offered to the page as the ctrl+wheel Chromium sends
// for a pinch. A page that zooms itself (a PDF, a canvas) keeps the whole
// pinch; else it zooms the document.
function gesture(type, event, scale) {
  send("zoomGesture", {
    type: type,
    scale: scale,
    x: event.clientX,
    y: event.clientY,
  });
}
function offerToPage(event, ratio) {
  var target = document.elementFromPoint(event.clientX, event.clientY);
  if (!target) return false;
  var step = new WheelEvent("wheel", {
    deltaY: -100 * Math.log(ratio),
    ctrlKey: true,
    clientX: event.clientX,
    clientY: event.clientY,
    bubbles: true,
    cancelable: true,
  });
  synthetic = true;
  try {
    return !target.dispatchEvent(step);
  } finally {
    synthetic = false;
  }
}
window.addEventListener("gesturestart", function (event) {
  if (event.defaultPrevented) return;
  event.preventDefault();
  pinch = { last: 1, owner: null };
});
window.addEventListener("gesturechange", function (event) {
  if (event.defaultPrevented || !pinch || !(event.scale > 0)) return;
  event.preventDefault();
  var ratio = event.scale / pinch.last;
  pinch.last = event.scale;
  if (!pinch.twins && pinch.owner !== "window" && offerToPage(event, ratio)) {
    pinch.owner = "page";
    return;
  }
  if (pinch.owner === "page") return;
  if (!pinch.owner) {
    pinch.owner = "window";
    gesture("gesturestart", event, 1);
  }
  gesture("gesturechange", event, event.scale);
});
window.addEventListener("gestureend", function (event) {
  if (event.defaultPrevented || !pinch) return;
  event.preventDefault();
  if (pinch.owner === "window") gesture("gestureend", event, event.scale);
  pinch = null;
});

// Android's web view turns two fingers' pinch into neither gesture events
// nor a ctrl+wheel: their spread is offered to the page as the same steps.
// A page that doesn't zoom itself is left the touch. WebKit, with gesture
// events of its own, is answered above.
var spread = null;
function twoFingers(touches) {
  var a = touches[0];
  var b = touches[1];
  return {
    apart: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2,
  };
}
// Its touchmove listener is held from the start: one added with the second
// finger comes after Chromium has made the touch's moves uncancelable. A
// move without a pinch on returns at once.
function pinchMove(event) {
  if (!spread || spread.page === false || event.touches.length !== 2) return;
  var at = twoFingers(event.touches);
  if (!(at.apart > 0)) return;
  var ratio = at.apart / spread.last;
  spread.last = at.apart;
  spread.page = offerToPage(at, ratio);
  if (spread.page && event.cancelable) event.preventDefault();
}
function pinchEnd() {
  spread = null;
}
if (!("ongesturestart" in window))
  window.addEventListener("touchmove", pinchMove, { passive: false });
window.addEventListener("touchstart", function (event) {
  pinchEnd();
  var gestures = "ongesturestart" in window;
  if (gestures || event.touches.length !== 2 || event.defaultPrevented) return;
  var at = twoFingers(event.touches);
  if (!(at.apart > 0)) return;
  spread = { last: at.apart, page: null };
});
window.addEventListener("touchend", function (event) {
  if (event.touches.length < 2) pinchEnd();
});
window.addEventListener("touchcancel", pinchEnd);

// Where a menu opens: under an element, or at a point of the page.
function anchor(at) {
  if (at && typeof at.getBoundingClientRect === "function") {
    var box = at.getBoundingClientRect();
    return { x: box.left, y: box.bottom };
  }
  return { x: (at && at.x) || 0, y: (at && at.y) || 0 };
}
