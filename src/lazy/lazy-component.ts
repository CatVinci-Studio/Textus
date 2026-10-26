import { lazy, type ComponentType } from "react";
import type { LazyModule } from "./lazy-module";

/** A component from a lazy module, for use under a <Suspense>: it renders
 *  once the module has loaded. */
export function lazyComponent<M, P extends object>(
  module: LazyModule<M>,
  pick: (loaded: M) => ComponentType<P>,
): ComponentType<P> {
  return lazy(() =>
    module.load().then((loaded) => ({ default: pick(loaded) })),
  );
}
