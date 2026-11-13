import { checkPlugin, type PluginCheck } from "./plugin-check";
import { parseManifest } from "./manifest";
import { engineSatisfied } from "./versions";

/** A plugin Create mode's AI wrote, as its check_plugin tool reads it: the
 *  manifest as install parses it, the `local.` id install needs, and what
 *  checkPlugin finds in the code. The answer is for the model, in English. */
export function checkWrittenPlugin(files: unknown, version: string): string {
  const list = Array.isArray(files)
    ? files
        .filter(
          (f): f is { path: string; text: string } =>
            !!f && typeof f.path === "string" && typeof f.text === "string",
        )
        .map((f) => ({ path: f.path.replace(/^\.\//, ""), text: f.text }))
    : [];
  const manifestFile = list.find((f) => f.path === "textus-plugin.json");
  if (!manifestFile)
    return "No textus-plugin.json among the files: pass every file the plugin has.";
  let manifest;
  try {
    manifest = parseManifest(manifestFile.text);
  } catch (err) {
    return `textus-plugin.json doesn't install: ${(err as Error).message}`;
  }
  const problems: string[] = [];
  const range = manifest.engine;
  if (!engineSatisfied(range, version))
    problems.push(
      `engines.textus "${range}" leaves out this Textus (${version}): use ">=${version}" or a range that holds it.`,
    );
  if (!manifest.id.startsWith("local."))
    problems.push(
      `The id must start with "local." for a plugin written here - ${manifest.id} would be refused at install.`,
    );
  for (const main of manifest.main ?? [])
    if (!list.some((f) => f.path === main.replace(/^\.\//, "")))
      problems.push(`main names ${main}, which isn't among the files.`);
  problems.push(...checkPlugin(manifest, list).map(sentence));
  const textus = `(This is Textus ${version}.)`;
  return problems.length
    ? `Fix these, then check again:\n${problems.map((p) => `- ${p}`).join("\n")}\n${textus}`
    : `No problems found: the manifest installs and the code asks for what it uses. ${textus}`;
}

function sentence(check: PluginCheck): string {
  switch (check.kind) {
    case "dom":
      return "host.js reaches for the DOM (document, window, localStorage): it runs in a hidden frame, so nothing it draws shows - draw in a webview page instead.";
    case "permission":
      return `The code uses what needs "${check.permission}", which the manifest's permissions leave out.`;
    case "unregistered":
      return `The manifest declares ${check.id}, but the code never registers it.`;
    case "when":
      return `A menu item's "when" reads ${check.key}, which Textus never sets: the item would never show.`;
  }
}
