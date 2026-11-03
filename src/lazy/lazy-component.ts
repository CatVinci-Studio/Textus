import { createElement, lazy, useState, type ComponentType } from "react";
import type { LazyModule } from "./lazy-module";

/** A component from a lazy module, for use under a <Suspense>: it renders
 *  once the module has loaded, and at once where it already has - no frame
 *  of the fallback in its place. */
export function lazyComponent<M, P extends object>(
  module: LazyModule<M>,
  pick: (loaded: M) => ComponentType<P>,
): ComponentType<P> {
  const Lazy = lazy(() =>
    module.load().then((loaded) => ({ default: pick(loaded) })),
  );
  return function LazyComponent(props: P) {
    // Chosen once, so a load while it is shown doesn't remount it.
    const [Component] = useState<ComponentType<P>>(() => {
      const loaded = module.peek();
      return loaded === undefined ? Lazy : pick(loaded);
    });
    return createElement(Component, props);
  };
}
