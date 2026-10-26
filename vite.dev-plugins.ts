import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * The official plugins, in development and the browser tests, read from a
 * checkout of CatVinci-Studio/textus-plugins as the published catalog
 * would offer them: `/dev-plugins/index.json` (the catalog, its packages
 * left unbuilt) and `/dev-plugins/<id>/<file>`, the libraries its libs.json
 * names taken from that checkout's node_modules. The dev shim installs
 * from here (src/dev/tauri-shim.ts); the app itself ships no plugin.
 *
 * Where the checkout is: TEXTUS_PLUGINS_DIR, else a `textus-plugins`
 * folder beside this repository or above it. Without one, the catalog is
 * empty and the official plugins' tests are skipped.
 */
export function pluginsCheckout(): string | null {
  const named = process.env.TEXTUS_PLUGINS_DIR;
  if (named)
    return existsSync(join(named, "libs.json")) ? resolve(named) : null;
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, "textus-plugins");
    if (existsSync(join(candidate, "libs.json"))) return candidate;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function catalog(root: string) {
  const plugins = join(root, "plugins");
  return {
    schema: 1,
    plugins: readdirSync(plugins)
      .filter((id) => statSync(join(plugins, id)).isDirectory())
      .sort()
      .map((id) => {
        const manifest = JSON.parse(
          readFileSync(join(plugins, id, "textus-plugin.json"), "utf8"),
        );
        return {
          id,
          version: manifest.version,
          official: manifest.publisher === "catvinci",
          manifest,
          url: `/dev-plugins/${id}`,
          sha256: "",
          size: 0,
          // As the catalog release has them: a plugin's screenshots/*.png.
          screenshots: existsSync(join(plugins, id, "screenshots"))
            ? readdirSync(join(plugins, id, "screenshots"))
                .filter((name) => name.endsWith(".png"))
                .sort()
                .map((name) => `/dev-plugins/${id}/screenshots/${name}`)
            : [],
        };
      }),
  };
}

const TYPES: Record<string, string> = {
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  css: "text/css",
  html: "text/html",
  svg: "image/svg+xml",
};

export function devPlugins(): Plugin {
  return {
    name: "textus-dev-plugins",
    apply: "serve",
    configureServer(server) {
      const root = pluginsCheckout();
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? "").split("?")[0]);
        if (!path.startsWith("/dev-plugins/")) return next();
        const send = (status: number, body: string | Buffer, type: string) => {
          res.statusCode = status;
          res.setHeader("Content-Type", type);
          res.end(body);
        };
        if (!root) return send(404, "No textus-plugins checkout", "text/plain");
        const rel = path.slice("/dev-plugins/".length);
        if (rel === "index.json")
          return send(200, JSON.stringify(catalog(root)), TYPES.json);
        const libs = JSON.parse(readFileSync(join(root, "libs.json"), "utf8"));
        // A library file, or one in a library folder (its name ends in "/").
        const folder = Object.keys(libs).find(
          (target) => target.endsWith("/") && rel.startsWith(target),
        );
        const file = libs[rel]
          ? join(root, "node_modules", libs[rel])
          : folder
            ? normalize(
                join(
                  root,
                  "node_modules",
                  libs[folder],
                  rel.slice(folder.length),
                ),
              )
            : normalize(join(root, "plugins", rel));
        if (!file.startsWith(join(root, "")) || !existsSync(file))
          return send(404, `${rel}: no such file`, "text/plain");
        if (statSync(file).isDirectory())
          return send(404, `${rel}: a folder`, "text/plain");
        const ext = file.split(".").pop() ?? "";
        send(200, readFileSync(file), TYPES[ext] ?? "application/octet-stream");
      });
    },
  };
}
