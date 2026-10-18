export interface DictationTargetSession {
  apply(text: string): boolean;
  finish?: () => void;
}
const targets = new WeakMap<HTMLElement, () => DictationTargetSession | null>();
export function registerDictationTarget(
  element: HTMLElement,
  capture: () => DictationTargetSession | null,
): () => void {
  targets.set(element, capture);
  return () => {
    if (targets.get(element) === capture) targets.delete(element);
  };
}
export function hasDictationTarget(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement)
    if (targets.has(node)) return true;
  return false;
}
export function captureDictationTarget(
  element: HTMLElement,
): DictationTargetSession | null {
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    const capture = targets.get(node);
    if (capture) return capture();
  }
  return null;
}
