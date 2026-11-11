/**
 * How the pill a tab becomes between windows looks, as this window draws
 * a lifted tab (components.css .tab-pill-lifted): its tokens resolved to
 * values, for the pill's own small window (public/dragpill.html).
 */
export function dragPillLook(): string {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string) => root.getPropertyValue(name).trim();
  const body = getComputedStyle(document.body);
  return [
    `--pill-bg:${token("--ui-surface")}`,
    `--pill-fg:${token("--ui-text")}`,
    `--pill-edge:${token("--ui-border")}`,
    `--pill-shadow:${token("--shadow-popover")}`,
    `--pill-font:${body.fontFamily}`,
    `--pill-size:${token("--text-secondary")}`,
  ].join(";");
}
