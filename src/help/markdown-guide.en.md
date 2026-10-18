# Textus Markdown Guide

Welcome! This built-in document demonstrates the Markdown rendering Textus supports. It is just an unsaved draft — feel free to edit and experiment, then close it without saving.

> [!TIP]
> Press `Cmd+/` to toggle between WYSIWYG and source mode and see the raw syntax behind any example here.

## Headings and quotes

Type `#` plus a space at the start of a line for a level-1 heading, or `##` plus a space for level 2. The headings above show the rendered result.

A blockquote:

> Quoted text can nest other marks, like **bold** and `code`.

GitHub-style alerts:

> [!NOTE]
> A note, for extra context.

> [!WARNING]
> A warning, for things to watch out for.

## Inline styles

**Bold** (`**text**`), *italic* (`*text*`), ***bold italic***, ~~strikethrough~~ (`~~text~~`), ==highlight== (`==text==`), and `inline code`.

Links look like this: [the Textus repository](https://github.com/CatVinci-Studio/Textus). Ctrl/⌘+click one to follow it: a web link opens in your browser, a link to another Markdown file opens it in a tab, and a link to `#a-heading` scrolls there. Inline HTML renders too, e.g. keyboard keys <kbd>Cmd</kbd> + <kbd>S</kbd>. So do `<details>` folds, HTML tables, a few inline styles (colour, background, size, weight, alignment, underline and strikethrough) and inline `<svg>`, which shows as a picture. Scripts and other HTML stay as source.

Inline math: mass–energy equivalence $E = mc^2$, Euler's identity $e^{i\pi} + 1 = 0$.

## Lists

- Unordered list
- With nesting
  - A second-level item
  - Another one

1. Ordered list
2. Second item

Task list (click a checkbox to toggle it):

- [x] Something done
- [ ] Something to do

## Tables

| Feature | Syntax | Result |
| --- | --- | --- |
| Bold | `**text**` | **text** |
| Highlight | `==text==` | ==text== |
| Inline math | `$x^2$` | $x^2$ |

Hover over a table to add or remove rows and columns. Type `| Name | Age |` and press Enter to make a table. Enter moves down a row, adds one at the last row, and leaves the table from a new row left empty; Ctrl/⌘+Enter leaves it at any time.

## Code blocks

Fenced code blocks with syntax highlighting (switch the language from the block's top-right corner). Enter on the empty last line leaves the block, as does Ctrl/⌘+Enter at any time; the same goes for quotes.

```python
def fib(n: int) -> int:
    """The classic Fibonacci sequence."""
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

```rust
fn main() {
    let greeting = "Hello, Textus!";
    println!("{greeting}");
}
```

## Math blocks

Block formulas wrapped in `$$` are rendered by KaTeX:

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

## Diagrams (Mermaid)

A ```` ```mermaid ```` code block renders as a live diagram. A flowchart:

```mermaid
flowchart LR
    A[Write Markdown] --> B{Need a diagram?}
    B -- Yes --> C[Sketch it in Mermaid]
    B -- No --> D[Keep writing]
    C --> D
```

A Gantt chart:

```mermaid
gantt
    title Sample project schedule
    dateFormat YYYY-MM-DD
    section Design
    Requirements   :done,    des1, 2026-07-01, 5d
    UI design      :active,  des2, after des1, 7d
    section Build
    Core features  :         dev1, after des2, 10d
    Polish & test  :         dev2, after dev1, 5d
```

A sequence diagram:

```mermaid
sequenceDiagram
    participant You
    participant Textus
    You->>Textus: Type Markdown
    Textus-->>You: Rendered live
```

## Images

Paste an image straight from the clipboard — Textus saves it to an `assets/` folder next to the document and inserts the reference. Or write it by hand:

In **Settings → Editor & Appearance → Images**, you can instead send newly pasted images to your own image host. The endpoint receives `multipart/form-data` with a `file` field and may return either the public URL as plain text or in a configurable JSON field. Uploaded files can be renamed automatically, keep their original name, or ask you for a name before every upload. Existing image references are never changed when you switch storage modes.

```markdown
![alt text](assets/screenshot.png)
```

## Views and modes

Besides the WYSIWYG editor and source mode (`Cmd+/`), Textus has three ways to write (on Windows and Linux use `Ctrl` for `Cmd`; Settings → Shortcuts has the current bindings):

- **Split view** (`Cmd+Shift+E`): the Markdown source on the left, the rendered preview on the right, scrolling together.
- **Typewriter mode** (Settings → Editor & Appearance → Theme): the line you are typing stays in the middle of the window — in the editor, source mode and split view.
- **Zen mode** (`Cmd+Shift+J`): hides everything but the text, goes fullscreen and dims every paragraph except the one you are writing. Press `Esc` to leave.

All three are also in the **View** menu.

## Footnotes and rules

Footnotes look like this[^1], and below is a horizontal rule:

---

[^1]: Footnote content is collected at the end of the document.

Happy writing!
