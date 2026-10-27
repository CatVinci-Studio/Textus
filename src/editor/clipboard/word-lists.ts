/**
 * Word's lists come on the clipboard as styled paragraphs (`mso-list:l0
 * level2`) with the bullet as text. This rebuilds them as nested HTML lists
 * before ProseMirror reads the paste.
 */
export function wordListsToHtml(html: string): string {
  if (!/mso-list/i.test(html)) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  const items = [
    ...template.content.querySelectorAll<HTMLElement>("p[style]"),
  ].filter((p) =>
    /mso-list:\s*l\d+\s+level\d+/i.test(p.getAttribute("style")!),
  );
  if (!items.length) return html;

  // Each run of consecutive items is one list; a deeper level nests in
  // the item before it.
  let stack: { list: HTMLElement; level: number }[] = [];
  let listId = "";
  for (const p of items) {
    const [, id, depth] = /mso-list:\s*(l\d+)\s+level(\d+)/i.exec(
      p.getAttribute("style")!,
    )!;
    const level = Number(depth);
    let bullet = "";
    for (const ignored of p.querySelectorAll<HTMLElement>("[style]")) {
      if (!/mso-list:\s*ignore/i.test(ignored.getAttribute("style")!)) continue;
      bullet += ignored.textContent ?? "";
      ignored.remove();
    }
    // Without the span (some copies drop it), the bullet leads the text.
    const first = p.firstChild;
    if (!bullet && first?.nodeType === Node.TEXT_NODE) {
      const lead = /^\s*([·•o§▪-]|\w{1,4}[.)])[\s\u00a0]+/.exec(
        first.textContent!,
      );
      if (lead) {
        bullet = lead[0];
        first.textContent = first.textContent!.slice(lead[0].length);
      }
    }
    const ordered = /^\s*(\d+|[a-z]|[ivxlc]+)[.)]/i.test(bullet);
    // Not right after the list before, or another Word list: a new one.
    if (p.previousElementSibling !== stack[0]?.list || id !== listId)
      stack = [];
    listId = id;
    while (stack.length && stack[stack.length - 1].level > level) stack.pop();
    let top = stack[stack.length - 1];
    if (!top || top.level < level) {
      const list = document.createElement(ordered ? "ol" : "ul");
      if (top) (top.list.lastElementChild ?? top.list).append(list);
      else p.before(list);
      top = { list, level };
      stack.push(top);
    }
    const li = document.createElement("li");
    li.append(...p.childNodes);
    top.list.append(li);
    p.remove();
  }
  return template.innerHTML;
}
