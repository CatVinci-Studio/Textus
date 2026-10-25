### Faster start

- Textus loads less before its first frame: Split View, the editor's
  menu, the first-run tour and the code that runs plugins now load the
  first time they are used. The startup bundle went from 1.32 MB to
  1.02 MB, and the build fails if it grows past 1.1 MB again.
