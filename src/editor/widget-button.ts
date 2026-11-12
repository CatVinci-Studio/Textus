/** A button drawn inside the document (a widget, a node view's tool): a
 *  press leaves the editor's caret and selection where they are, and its
 *  click is its own, not the editor's. */
export function widgetButton(
  className: string,
  text: string,
  onClick: (button: HTMLButtonElement) => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(button);
  });
  return button;
}
