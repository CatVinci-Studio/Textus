// Tabs whose editor must stay loaded though out of sight: Textus AI has a
// conversation, Quick Ask or a proposal open in it, or changes in it wait
// to be decided. Reported by each editor, read when a hidden tab would be
// let go.

const held = new Set<string>();

export function setEditorHeld(tabId: string, hold: boolean): void {
  if (hold) held.add(tabId);
  else held.delete(tabId);
}

export function editorHeld(tabId: string): boolean {
  return held.has(tabId);
}
