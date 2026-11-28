/**
 * What the engine benchmark counts in the page, frame by frame, in any
 * engine: inline style writes (which property, on which part of the
 * frame), layout reads and the ones that follow a write in the same task
 * (a forced layout, as the engine sees it), React commits and the
 * components they rendered, and observer callbacks. Installed before the
 * app loads; it costs time itself, so the timed runs go without it.
 *
 * A frame is bucketed by its animation-frame time stamp: what rAF and
 * ResizeObserver/IntersectionObserver callbacks do belongs to that frame,
 * what events, timers and microtasks do to the next one drawn.
 */

export interface ProbeFrame {
  /** "prop@part" -> writes. */
  writes: Record<string, number>;
  /** "read@part" -> reads. */
  reads: Record<string, number>;
  /** Reads that came after a write with no frame between. */
  forced: number;
  commits: number;
  /** Component name -> renders. */
  rendered: Record<string, number>;
  /** "kind site" -> callbacks. */
  observers: Record<string, number>;
  /** "prop site" -> writes; the site a stack location, named in Node. */
  sites: Record<string, number>;
}

interface ProbeWindow {
  __probe: { on: boolean; frames: ProbeFrame[] };
}

/** Runs in the page, before the app. */
export function installEngineProbe() {
  const blank = (): ProbeFrame => ({
    writes: {},
    reads: {},
    forced: 0,
    commits: 0,
    rendered: {},
    observers: {},
    sites: {},
  });
  const probe = { on: false, frames: [] as ProbeFrame[] };
  (window as unknown as ProbeWindow).__probe = probe;
  let current = blank();
  let next = blank();
  let stamp = -1;
  let inFrame = false;
  let dirty = false;
  const bump = (m: Record<string, number>, k: string) =>
    (m[k] = (m[k] ?? 0) + 1);
  const target = () => (inFrame ? current : next);
  const close = (t: number) => {
    if (t === stamp) return;
    if (probe.on && stamp >= 0) probe.frames.push(current);
    stamp = t;
    current = next;
    next = blank();
    dirty = false;
  };

  // Which part of the frame an element is: its frame key's kind, else its
  // first class, else its tag.
  const partOf = (el: Element | null | undefined): string => {
    if (!el) return "?";
    const frame = el.getAttribute("data-frame");
    if (frame) return frame.split(":")[0]!;
    if (el.hasAttribute("data-strip-key")) return "tab";
    const strip = el.getAttribute("class")?.split(/\s+/)[0];
    return strip || el.tagName.toLowerCase();
  };
  const siteOf = (): string => {
    const lines = (new Error().stack ?? "").split("\n");
    for (const line of lines) {
      const at = /(https?:\/\/[^\s)]+):(\d+):\d+/.exec(line);
      if (at) return `${at[1]!.replace(/^.*\/assets\//, "")}:${at[2]}`;
    }
    return "?";
  };

  // Every inline style write, whichever way it is made: el.style is
  // handed out behind a proxy (Chromium's style properties are not
  // accessors that could be wrapped).
  const owners = new WeakMap<CSSStyleDeclaration, Element>();
  const proxies = new WeakMap<CSSStyleDeclaration, CSSStyleDeclaration>();
  const wrote = (decl: CSSStyleDeclaration, prop: string) => {
    dirty = true;
    if (!probe.on) return;
    const f = target();
    bump(f.writes, `${prop}@${partOf(owners.get(decl))}`);
    bump(f.sites, `${prop} ${siteOf()}`);
  };
  const styleGet = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "style",
  )?.get;
  if (styleGet)
    Object.defineProperty(HTMLElement.prototype, "style", {
      configurable: true,
      get(this: HTMLElement) {
        const decl = styleGet.call(this) as CSSStyleDeclaration;
        let proxy = proxies.get(decl);
        if (!proxy) {
          owners.set(decl, this);
          proxy = new Proxy(decl, {
            get(t, k) {
              const v = Reflect.get(t, k, t) as unknown;
              return typeof v === "function" ? v.bind(t) : v;
            },
            set(t, k, v) {
              if (typeof k === "string") wrote(t, k);
              return Reflect.set(t, k, v, t);
            },
          });
          proxies.set(decl, proxy);
        }
        return proxy;
      },
      set(this: HTMLElement, v: string) {
        (styleGet.call(this) as CSSStyleDeclaration).cssText = v;
      },
    });
  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (name, value, prio) {
    wrote(this, name.startsWith("--") ? "--var" : name);
    return setProperty.call(this, name, value, prio);
  };
  // Class and attribute changes dirty style too: a read after them is
  // forced all the same, though not counted as a write.
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (name === "class" || name === "style") dirty = true;
    return setAttribute.call(this, name, value);
  };
  for (const name of ["add", "remove", "toggle", "replace"] as const) {
    const fn = DOMTokenList.prototype[name] as (...a: unknown[]) => unknown;
    (DOMTokenList.prototype as unknown as Record<string, unknown>)[name] =
      function (this: DOMTokenList, ...a: unknown[]) {
        dirty = true;
        return fn.apply(this, a);
      };
  }

  const read = (el: Element | null, what: string) => {
    if (!probe.on) return;
    const f = target();
    bump(f.reads, `${what}@${partOf(el)}`);
    if (dirty) {
      f.forced++;
      dirty = false;
    }
  };
  const wrapMethod = (proto: object, name: string) => {
    const fn = (proto as Record<string, unknown>)[name] as
      ((...a: unknown[]) => unknown) | undefined;
    if (!fn) return;
    (proto as Record<string, unknown>)[name] = function (
      this: Element,
      ...a: unknown[]
    ) {
      read(this, name);
      return fn.apply(this, a);
    };
  };
  wrapMethod(Element.prototype, "getBoundingClientRect");
  wrapMethod(Element.prototype, "getClientRects");
  const getComputed = window.getComputedStyle;
  window.getComputedStyle = function (el: Element, pseudo?: string | null) {
    read(el, "getComputedStyle");
    return getComputed.call(window, el, pseudo);
  };
  const GETTERS: [object, string[]][] = [
    [
      HTMLElement.prototype,
      ["offsetWidth", "offsetHeight", "offsetLeft", "offsetTop"],
    ],
    [
      Element.prototype,
      [
        "clientWidth",
        "clientHeight",
        "scrollWidth",
        "scrollHeight",
        "scrollTop",
        "scrollLeft",
      ],
    ],
  ];
  for (const [proto, names] of GETTERS)
    for (const name of names) {
      const d = Object.getOwnPropertyDescriptor(proto, name);
      if (!d?.get) continue;
      const get = d.get;
      Object.defineProperty(proto, name, {
        ...d,
        get(this: Element) {
          read(this, name);
          return get.call(this);
        },
      });
    }

  // Animation frames: the first callback with a new time stamp opens it.
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      close(t);
      inFrame = true;
      try {
        cb(t);
      } finally {
        inFrame = false;
      }
    });
  // Our own loop keeps frames closing while nothing else asks for one.
  const loop = (t: number) => {
    close(t);
    raf(loop);
  };
  raf(loop);

  type Ctor = new (cb: (...a: unknown[]) => void, o?: unknown) => object;
  const observers: [string, Ctor | undefined, boolean][] = [
    ["ResizeObserver", window.ResizeObserver as unknown as Ctor, true],
    [
      "IntersectionObserver",
      window.IntersectionObserver as unknown as Ctor,
      true,
    ],
    ["MutationObserver", window.MutationObserver as unknown as Ctor, false],
  ];
  for (const [kind, Base, rendering] of observers) {
    if (!Base) continue;
    const Wrapped = class extends Base {
      constructor(cb: (...a: unknown[]) => void, o?: unknown) {
        const site = siteOf();
        super((...a: unknown[]) => {
          if (probe.on)
            bump((rendering ? current : next).observers, `${kind} ${site}`);
          const was = inFrame;
          inFrame = rendering;
          try {
            cb(...a);
          } finally {
            inFrame = was;
          }
        }, o);
      }
    };
    (window as unknown as Record<string, unknown>)[kind] = Wrapped;
  }

  // React's devtools hook: every commit, and the components that rendered
  // in it (fibers flagged PerformedWork).
  type Fiber = {
    tag: number;
    flags: number;
    type: {
      name?: string;
      displayName?: string;
      render?: { name?: string };
    } | null;
    child: Fiber | null;
    sibling: Fiber | null;
  };
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  (
    window as unknown as Record<string, unknown>
  ).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    onScheduleFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    checkDCE: () => {},
    onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
      if (!probe.on) return;
      const f = target();
      f.commits++;
      const stack: Fiber[] = [root.current];
      while (stack.length) {
        const fiber = stack.pop()!;
        if (fiber.flags & 1 && COMPONENT_TAGS.has(fiber.tag)) {
          const t = fiber.type;
          const name = t?.displayName || t?.name || t?.render?.name || "anon";
          bump(f.rendered, name);
        }
        if (fiber.child) stack.push(fiber.child);
        if (fiber.sibling) stack.push(fiber.sibling);
      }
    },
  };
}

/** Starts counting from the next frame. */
export function probeStart() {
  const p = (window as unknown as ProbeWindow).__probe;
  p.frames = [];
  p.on = true;
}

/** Stops counting and returns the frames. */
export function probeStop(): ProbeFrame[] {
  const p = (window as unknown as ProbeWindow).__probe;
  p.on = false;
  return p.frames;
}
