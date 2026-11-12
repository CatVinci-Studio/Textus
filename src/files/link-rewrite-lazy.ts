import { lazyModule } from "../lazy/lazy-module";

/** The link rewriter, loaded on the first move that needs it: nothing at
 *  startup rewrites links. */
export const linkRewrite = lazyModule(
  "link-rewrite",
  () => import("./link-rewrite"),
);
