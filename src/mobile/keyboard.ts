/**
 * Whether the iOS keyboard is up, read off the window's height: the web view
 * shrinks by the keyboard's height. A rotation (a new width) starts over.
 */
let tallest = 0;
let width = 0;

function track() {
  if (window.innerWidth !== width) {
    width = window.innerWidth;
    tallest = window.innerHeight;
  } else tallest = Math.max(tallest, window.innerHeight);
}

if (typeof window !== "undefined") {
  track();
  window.addEventListener("resize", track);
}

/** Less than this much shorter is a bar, not a keyboard (a hardware
 *  keyboard's shortcut strip on an iPad). */
const KEYBOARD_MIN = 120;

export function keyboardUp(): boolean {
  track();
  return window.innerHeight < tallest - KEYBOARD_MIN;
}

/**
 * Runs `then` once the keyboard is down - at once if it is - or after
 * `timeout` ms whatever the window says. Returns a cancel.
 */
export function whenKeyboardDown(then: () => void, timeout = 600) {
  if (!keyboardUp()) {
    then();
    return () => {};
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener("resize", onResize);
    clearTimeout(timer);
    then();
  };
  const onResize = () => {
    if (!keyboardUp()) finish();
  };
  window.addEventListener("resize", onResize);
  const timer = setTimeout(finish, timeout);
  return () => {
    done = true;
    window.removeEventListener("resize", onResize);
    clearTimeout(timer);
  };
}
