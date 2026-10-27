### Improved

- Plugins can delete characters without copying them (`deleteChars` with `copy: false`), so a Vim mapping like `inoremap jj <Esc>` no longer leaves a "j" on the clipboard.
