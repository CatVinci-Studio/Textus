// Templater's tags (<% tp.date.now() %> and the like), as textus.templates
// fills them: the second part of the text runtime (text-runtime.ts), on the
// dates of the first. Plain JavaScript, put into the host frame as is.
/* global __textusText */
(function (root) {
  var dates = root.dates;
  const TAG = /<%([-_*+]?)([\s\S]*?)([-_]?)%>/g;
  const CALL = /^(tp(?:\.\w+)+)\s*(?:\(([\s\S]*)\))?$/;
  const ARG =
    /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(-?\d+(?:\.\d+)?)|(true|false))\s*(,|$)/y;
  const DURATION =
    /^([+-])?P(?:([+-]?\d+)Y)?(?:([+-]?\d+)M)?(?:([+-]?\d+)W)?(?:([+-]?\d+)D)?$/i;
  const CURSOR = {};

  /** `<%-` and `-%>` take one line break beside the tag, `_` every space. */
  const TRIM_BEFORE = {
    "-": (s) => s.replace(/\r?\n$/, ""),
    _: (s) => s.replace(/\s+$/, ""),
    "": (s) => s,
  };
  const TRIM_AFTER = { "-": /^\r?\n/, _: /^\s*/, "": /^/ };

  /** A tag's arguments, JavaScript strings, numbers and booleans; null
   *  for anything else (a variable, a template string). */
  function args(text) {
    const out = [];
    if (!text || !text.trim()) return out;
    ARG.lastIndex = 0;
    while (ARG.lastIndex < text.length) {
      const m = ARG.exec(text);
      if (!m) return null;
      const quoted = m[1] !== undefined ? m[1] : m[2];
      out.push(
        quoted !== undefined
          ? quoted.replace(/\\(.)/g, "$1")
          : m[3] !== undefined
            ? Number(m[3])
            : m[4] === "true",
      );
      if (!m[5]) break;
    }
    return out;
  }

  /** `date` moved by Templater's offset: days, or an ISO 8601 duration
   *  ("P1W", "-P1M"); null for one this can't read. */
  function shifted(date, offset) {
    const at = new Date(date.getTime());
    if (offset === undefined || offset === "") return at;
    if (typeof offset === "number")
      return (at.setDate(at.getDate() + offset), at);
    const m = DURATION.exec(String(offset));
    if (!m || !(m[2] || m[3] || m[4] || m[5])) return null;
    const sign = m[1] === "-" ? -1 : 1;
    const n = (i) => sign * Number(m[i] || 0);
    at.setFullYear(
      at.getFullYear() + n(2),
      at.getMonth() + n(3),
      at.getDate() + 7 * n(4) + n(5),
    );
    return at;
  }

  const day = (c, days, form) =>
    dates.format(shifted(c.now, days), form || "YYYY-MM-DD", c.language);

  /** The tags read: `call` when written with brackets. A run gives the
   *  text, CURSOR, or null to leave the tag as written. */
  const TAGS = {
    "tp.date.now": {
      call: true,
      run: (c, form, offset, reference) => {
        const at = reference === undefined ? shifted(c.now, offset) : null;
        return at && dates.format(at, form || "YYYY-MM-DD", c.language);
      },
    },
    "tp.date.today": { call: true, run: (c, form) => day(c, 0, form) },
    "tp.date.tomorrow": { call: true, run: (c, form) => day(c, 1, form) },
    "tp.date.yesterday": { call: true, run: (c, form) => day(c, -1, form) },
    "tp.file.title": { call: false, run: (c) => c.title },
    "tp.file.creation_date": {
      call: true,
      run: (c, form) =>
        dates.format(
          c.created || c.now,
          form || "YYYY-MM-DD HH:mm",
          c.language,
        ),
    },
    "tp.file.folder": {
      call: true,
      run: (c, absolute) =>
        absolute ? c.folder || "/" : c.folder.split("/").pop(),
    },
    "tp.file.cursor": { call: true, run: () => CURSOR },
  };

  /** What one tag's inside gives; null for one not read. */
  function value(body, c) {
    const m = CALL.exec(body.trim());
    const tag = m && TAGS[m[1]];
    if (!tag || tag.call !== (m[2] !== undefined)) return null;
    const given = tag.call ? args(m[2]) : [];
    if (!given) return null;
    const out = tag.run(c, ...given);
    return out === null || out === undefined ? null : out;
  }

  /**
   * `text` with the tags it knows filled in, for a document titled
   * `c.title` in the folder `c.folder` ("/"-separated, "" for the top), at
   * `c.now`, names in `c.language`. Gives the text, where the caret goes
   * (the first tp.file.cursor(), the lowest numbered; null for none) and
   * the tags left as written.
   */
  function fill(text, c) {
    let out = "";
    let last = 0;
    let caret = null;
    const skipped = [];
    const source = String(text);
    for (const m of source.matchAll(TAG)) {
      const got = m[1] === "*" || m[1] === "+" ? null : value(m[2], c);
      if (got === null) {
        skipped.push(m[0]);
        continue;
      }
      out += TRIM_BEFORE[m[1]](source.slice(last, m.index));
      if (got === CURSOR) {
        const order = Number(args(CALL.exec(m[2].trim())[2])[0] || 0);
        if (!caret || order < caret.order)
          caret = { order: order, at: out.length };
      } else out += String(got);
      last = m.index + m[0].length;
      last += TRIM_AFTER[m[3]].exec(source.slice(last))[0].length;
    }
    out += source.slice(last);
    return { text: out, cursor: caret ? caret.at : null, skipped: skipped };
  }

  /** Where `at` (an offset in `doc`) is for editor.reveal: its line, and
   *  the rest of that line when it is plain words found once. */
  function place(doc, at) {
    const line = doc.slice(0, at).split("\n").length - 1;
    const rest = doc.slice(at).split("\n")[0].trim();
    const plain = /^[\p{L}\p{N}\s,.;:!?'’()-]+$/u.test(rest);
    return plain && doc.indexOf(rest) === doc.lastIndexOf(rest)
      ? { line: line, text: rest }
      : { line: line };
  }

  root.templater = { fill: fill, place: place };
})(__textusText);
