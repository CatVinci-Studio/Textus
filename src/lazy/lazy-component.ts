import { createElement, useEffect, useState, type ComponentType } from "react";
import type { LazyModule } from "./lazy-module";

/** A component from a lazy module: drawn at once where the module has
 *  loaded, else nothing until it has, then drawn. Not through Suspense,
 *  which holds a page that suspended back for 300ms however fast its code
 *  arrives; a module's code is read from the app's own files in a few ms.
 *  A load that fails throws to the nearest error boundary. */
export function lazyComponent<M, P extends object>(
  module: LazyModule<M>,
  pick: (loaded: M) => ComponentType<P>,
): ComponentType<P> {
  return function LazyComponent(props: P) {
    // Chosen once loaded, so a later load elsewhere doesn't remount it.
    const [state, setState] = useState<
      { Component: ComponentType<P> } | { error: unknown } | null
    >(() => {
      const loaded = module.peek();
      return loaded === undefined ? null : { Component: pick(loaded) };
    });
    useEffect(() => {
      if (state) return;
      let live = true;
      module.load().then(
        (loaded) => live && setState({ Component: pick(loaded) }),
        (error: unknown) => live && setState({ error }),
      );
      return () => {
        live = false;
      };
    }, [state]);
    if (!state) return null;
    if ("error" in state) throw state.error;
    return createElement(state.Component, props);
  };
}
