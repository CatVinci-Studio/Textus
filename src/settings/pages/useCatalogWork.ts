import { useRef, useState } from "react";

/**
 * One catalog item's work at a time - installing, updating - for the
 * plugins, skills and themes lists alike: which item is busy (its button
 * waits, the others don't), and what went wrong, said once. `report`
 * shows a failure its own way; by default it is kept as `error` for the
 * list to show inline.
 */
export function useCatalogWork(report?: (text: string) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);
  /** Runs `work` for item `id`; `failed` words what went wrong, or null
   *  to say it later (several, at once). */
  const run = async (
    id: string,
    work: () => Promise<void>,
    failed: (err: unknown) => string | null,
  ): Promise<boolean> => {
    if (working.current) return false;
    working.current = true;
    setBusy(id);
    setError(null);
    try {
      await work();
      return true;
    } catch (err) {
      const text = failed(err);
      if (text === null) return false;
      if (report) report(text);
      else setError(text);
      return false;
    } finally {
      working.current = false;
      setBusy(null);
    }
  };
  return { busy, error, run };
}
