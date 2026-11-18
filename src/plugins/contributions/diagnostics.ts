import type { SentBlock } from "../../editor/markdown/doc-blocks";
import { createSubscribers } from "../../utils/store";

/**
 * The plugins that find slips in the text (a Markdown rule broken, a space
 * missing between Chinese and English): asked for the blocks in sight once
 * the document rests, answered within a fifth of a second or not at all.
 */
export interface PluginDiagnostic {
  block: string;
  /** The words it is about; all of the block's text without. */
  anchor?: string;
  severity: "error" | "warning" | "info";
  message: string;
  /** What the card offers: the words `anchor` becomes, or the block's
   *  Markdown made anew (with its button's label). */
  fix?: string | BlockFix;
}

export interface BlockFix {
  markdown: string;
  label?: string;
}

const isBlockFix = (f: unknown): f is BlockFix =>
  !!f &&
  typeof (f as BlockFix).markdown === "string" &&
  ((f as BlockFix).label === undefined ||
    typeof (f as BlockFix).label === "string");

type Ask = (
  blocks: SentBlock[],
  all: readonly SentBlock[],
  path: string | null,
) => Promise<PluginDiagnostic[]>;

interface Provider {
  plugin: string;
  /** The plugin's name, on the card. */
  name: string;
  ask: Ask;
}

/** By the plugin and the provider's own id. */
const providers = new Map<string, Provider>();
const subscribers = createSubscribers();

export function addDiagnosticProvider(key: string, provider: Provider): void {
  providers.set(key, provider);
  subscribers.publish();
}

export function removeDiagnosticProviders(
  match: (key: string, provider: Provider) => boolean,
): void {
  let removed = false;
  for (const [key, provider] of providers)
    if (match(key, provider)) removed = providers.delete(key) || removed;
  if (removed) subscribers.publish();
}

export const hasDiagnosticProviders = () => providers.size > 0;

/** The editor asks again when a plugin starts or stops checking. */
export const onDiagnosticProviders = subscribers.subscribe;

/** What a check's answer may say: kept to its parts, a slip without words
 *  or a known severity left out. */
function wellFormed(d: unknown): d is PluginDiagnostic {
  const x = d as PluginDiagnostic | null;
  return (
    !!x &&
    typeof x.block === "string" &&
    typeof x.message === "string" &&
    x.message.trim() !== "" &&
    ["error", "warning", "info"].includes(x.severity) &&
    (x.anchor === undefined || typeof x.anchor === "string") &&
    (x.fix === undefined || typeof x.fix === "string" || isBlockFix(x.fix))
  );
}

/** Every plugin's slips in `blocks`, each with who found it. One that
 *  fails adds none; one slower than `timeoutMs` is named as late, so what
 *  it found before stays rather than reading as no slips. */
export async function diagnose(
  blocks: SentBlock[],
  doc: readonly SentBlock[],
  path: string | null,
  timeoutMs = 200,
): Promise<{
  answers: (PluginDiagnostic & { plugin: string; name: string })[];
  late: string[];
}> {
  const late: string[] = [];
  const all = await Promise.all(
    [...providers.values()].map(async ({ plugin, name, ask }) => {
      const found = await Promise.race([
        ask(blocks, doc, path).catch(() => []),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), timeoutMs),
        ),
      ]);
      if (found === null) late.push(plugin);
      return (Array.isArray(found) ? found : [])
        .filter(wellFormed)
        .map((d) => ({
          block: d.block,
          anchor: d.anchor,
          severity: d.severity,
          message: d.message.trim(),
          fix:
            typeof d.fix === "object"
              ? {
                  markdown: d.fix.markdown,
                  label: d.fix.label?.trim() || undefined,
                }
              : d.fix,
          plugin,
          name,
        }));
    }),
  );
  return { answers: all.flat(), late };
}
