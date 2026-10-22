/** Text made safe to place in HTML, as element content or inside a
 *  double-quoted attribute: the four characters that could end either. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
