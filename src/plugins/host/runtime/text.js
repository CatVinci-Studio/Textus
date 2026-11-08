// Dates in Moment-style formats and templates filled in as Obsidian and its
// Templater plugin fill them: textus.dates and textus.templates (host.js).
// Kept on one object of its own, so a plugin's own copy of these never
// meets it. Plain JavaScript, put into the host frame as is.
var __textusText = {};
(function (root) {
  "use strict";

  var pad = function (n, width) {
    return String(n).padStart(width || 2, "0");
  };
  var TOKENS =
    /\[([^\]]*)\]|YYYY|YY|Q|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|gggg|GGGG|ww|w|WW|W|HH|H|hh|h|mm|ss|s|A|a/g;
  var DAY_MS = 86400000;

  /** Moment's ordinal day (Do) in each language; English's otherwise. */
  var ORDINAL = {
    en: function (n) {
      var tens = n % 100;
      var unit = n % 10;
      if (tens >= 11 && tens <= 13) return n + "th";
      return n + ({ 1: "st", 2: "nd", 3: "rd" }[unit] || "th");
    },
    zh: (n) => n + "日",
    ja: (n) => n + "日",
    ko: (n) => n + "일",
    de: (n) => n + ".",
    ru: (n) => n + "-го",
    es: (n) => n + "º",
    pt: (n) => n + "º",
    fr: (n) => n + (n === 1 ? "er" : ""),
  };

  /** Moment's locale weeks: the day they start on (0 Sunday) and the day
   *  of January that is always in week 1 (as 7 + dow - doy). */
  var WEEKS = { en: [0, 6], ja: [0, 6], ko: [0, 6] };
  var ISO = [1, 4];

  var base = function (language) {
    return String(language || "en").split("-")[0];
  };
  var utcDay = function (date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  };

  /** `date`'s week and the year it belongs to, weeks starting on `dow`,
   *  week 1 holding January's (7 + dow - doy)th day. */
  function week(date, rule) {
    var dow = rule[0];
    var firstOf = function (year) {
      var anchor = new Date(year, 0, 7 + dow - rule[1]);
      return utcDay(anchor) - ((anchor.getDay() - dow + 7) % 7) * DAY_MS;
    };
    var at = utcDay(date);
    var year = date.getFullYear();
    if (at >= firstOf(year + 1)) year += 1;
    else if (at < firstOf(year)) year -= 1;
    return {
      week: Math.floor((at - firstOf(year)) / DAY_MS / 7) + 1,
      year: year,
    };
  }

  /** `date` written in a Moment format, names in `language`. */
  function format(date, form, language) {
    var name = function (options) {
      return date.toLocaleDateString(language || "en", options);
    };
    var hours = date.getHours();
    var locale = function () {
      return week(date, WEEKS[base(language)] || ISO);
    };
    var iso = function () {
      return week(date, ISO);
    };
    var values = {
      YYYY: () => String(date.getFullYear()),
      YY: () => String(date.getFullYear()).slice(-2),
      Q: () => String(Math.floor(date.getMonth() / 3) + 1),
      MMMM: () => name({ month: "long" }),
      MMM: () => name({ month: "short" }),
      MM: () => pad(date.getMonth() + 1),
      M: () => String(date.getMonth() + 1),
      Do: () => (ORDINAL[base(language)] || ORDINAL.en)(date.getDate()),
      DD: () => pad(date.getDate()),
      D: () => String(date.getDate()),
      dddd: () => name({ weekday: "long" }),
      ddd: () => name({ weekday: "short" }),
      gggg: () => String(locale().year),
      GGGG: () => String(iso().year),
      ww: () => pad(locale().week),
      w: () => String(locale().week),
      WW: () => pad(iso().week),
      W: () => String(iso().week),
      HH: () => pad(hours),
      H: () => String(hours),
      hh: () => pad(hours % 12 || 12),
      h: () => String(hours % 12 || 12),
      mm: () => pad(date.getMinutes()),
      ss: () => pad(date.getSeconds()),
      s: () => String(date.getSeconds()),
      A: () => (hours < 12 ? "AM" : "PM"),
      a: () => (hours < 12 ? "am" : "pm"),
    };
    return String(form || "YYYY-MM-DD").replace(
      TOKENS,
      function (all, literal) {
        return literal !== undefined ? literal : values[all]();
      },
    );
  }

  /** The days of `date`'s week by name (sunday … saturday), the week
   *  starting where `language`'s weeks do, as Moment's weekday() counts. */
  function weekDays(date, language) {
    var dow = (WEEKS[base(language)] || ISO)[0];
    var back = (date.getDay() - dow + 7) % 7;
    var out = {};
    [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ].forEach(function (name, i) {
      out[name] = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() - back + ((i - dow + 7) % 7),
      );
    });
    return out;
  }

  /** `date`'s local day as YYYY-MM-DD. */
  function day(date) {
    return format(date, "YYYY-MM-DD");
  }

  var escape = function (text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  /** The twelve month names in `language`, `width` "long" or "short". */
  function months(language, width) {
    var out = [];
    for (var i = 0; i < 12; i++)
      out.push(
        new Date(2000, i, 1).toLocaleDateString(language || "en", {
          month: width,
        }),
      );
    return out;
  }

  /** What each token of a name reads: the part of the date it gives
   *  (Y, M, D, or N for a month's name) and its pattern; tokens that give
   *  no part of the day only have to be there. */
  function readers(language) {
    var names = function (width) {
      var list = months(language, width);
      return {
        part: "N",
        source: "(" + list.map(escape).join("|") + ")",
        names: list,
      };
    };
    var digits = { source: "\\d{1,4}" };
    return {
      YYYY: { part: "Y", source: "(\\d{4})" },
      MMMM: names("long"),
      MMM: names("short"),
      MM: { part: "M", source: "(\\d{2})" },
      M: { part: "M", source: "(\\d{1,2})" },
      Do: { part: "D", source: "(\\d{1,2})[^\\s\\d]*" },
      DD: { part: "D", source: "(\\d{2})" },
      D: { part: "D", source: "(\\d{1,2})" },
      dddd: { source: "[^\\s/\\d]+" },
      ddd: { source: "[^\\s/\\d]+" },
      A: { source: "[AaPp][Mm]" },
      a: { source: "[AaPp][Mm]" },
      YY: digits,
      Q: digits,
      gggg: digits,
      GGGG: digits,
      ww: digits,
      w: digits,
      WW: digits,
      W: digits,
      HH: digits,
      H: digits,
      hh: digits,
      h: digits,
      mm: digits,
      ss: digits,
      s: digits,
    };
  }

  /** The YYYY-MM-DD a name written in `form` stands for; null for a
   *  name that isn't one. Month names are read in `language`. */
  function parse(text, form, language) {
    var read = readers(language);
    var order = [];
    var source = String(form || "YYYY-MM-DD").replace(
      new RegExp(TOKENS.source + "|[.*+?^${}()|\\\\]", "g"),
      function (all, literal) {
        if (literal !== undefined) return escape(literal);
        var reader = read[all];
        if (!reader) return "\\" + all;
        if (reader.part) order.push(reader);
        return reader.source;
      },
    );
    var m = new RegExp("^" + source + "$", "i").exec(String(text));
    if (!m) return null;
    var parts = {};
    order.forEach(function (reader, i) {
      var found = m[i + 1];
      if (reader.part !== "N") return (parts[reader.part] = Number(found));
      var at = reader.names.findIndex(
        (n) => n.toLowerCase() === found.toLowerCase(),
      );
      parts.M = at + 1;
    });
    if (!parts.Y || !parts.M || !parts.D) return null;
    var date = new Date(parts.Y, parts.M - 1, parts.D);
    if (date.getMonth() !== parts.M - 1) return null;
    return parts.Y + "-" + pad(parts.M) + "-" + pad(parts.D);
  }

  /** What an offset's unit (`{{date+1d}}`) adds to a date. */
  var UNITS = {
    y: (d, n) => d.setFullYear(d.getFullYear() + n),
    q: (d, n) => d.setMonth(d.getMonth() + 3 * n),
    M: (d, n) => d.setMonth(d.getMonth() + n),
    m: (d, n) => d.setMinutes(d.getMinutes() + n),
    w: (d, n) => d.setDate(d.getDate() + 7 * n),
    d: (d, n) => d.setDate(d.getDate() + n),
    h: (d, n) => d.setHours(d.getHours() + n),
    s: (d, n) => d.setSeconds(d.getSeconds() + n),
  };

  /** `value` as a Date: a Date, or text that starts with YYYY, YYYY-MM or
   *  YYYY-MM-DD (a time after it read too); null otherwise. */
  function asDate(value) {
    if (value instanceof Date) return isNaN(value) ? null : value;
    var text = String(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
      var at = new Date(text);
      return isNaN(at) ? null : at;
    }
    var m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(text);
    return m
      ? new Date(Number(m[1]), Number(m[2] || 1) - 1, Number(m[3] || 1))
      : null;
  }

  /** A value as a template writes it: a list joined with ", ", nothing for
   *  null, a date (or text starting with one, under a format) formatted;
   *  null for a format on what isn't a date. */
  function valueText(value, form, language) {
    var date =
      value instanceof Date || form !== undefined ? asDate(value) : null;
    if (date) return format(date, form || "YYYY-MM-DD", language);
    if (form !== undefined) return null;
    if (value === null || value === undefined) return "";
    return Array.isArray(value) ? value.join(", ") : String(value);
  }

  /**
   * A template's {{date}} and {{time}} filled in, as Obsidian writes them
   * ({{date:FORMAT}}, {{time:FORMAT}}, {{date+1d}}): the date is
   * `options.day`'s, the time `options.now`'s (both now when not given),
   * in `options.dateFormat` and `options.timeFormat` unless the tag names
   * one. Every other {{name}} found in `options.values` is filled in too
   * (valueText), and a value there wins over the clock's {{date}}; the
   * rest stay as written.
   */
  function fill(text, options) {
    var now = options.now || new Date();
    var date = options.day || now;
    var values = options.values || {};
    var defaults = {
      date: options.dateFormat || "YYYY-MM-DD",
      time: options.timeFormat || "HH:mm",
    };
    return String(text).replace(
      /\{\{\s*(\w+)(?:([+-]\d+)([yqMmwdhs]))?\s*(?::([^}]*))?\}\}/g,
      function (all, key, offset, unit, form) {
        var known =
          offset === undefined &&
          Object.prototype.hasOwnProperty.call(values, key);
        var shown = known
          ? valueText(values[key], form, options.language)
          : null;
        if (shown !== null) return shown;
        if (!known && (key === "date" || key === "time")) {
          var at = new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            now.getHours(),
            now.getMinutes(),
            now.getSeconds(),
          );
          if (offset) UNITS[unit](at, Number(offset));
          return format(at, form || defaults[key], options.language);
        }
        return all;
      },
    );
  }

  /**
   * A new periodic note's template filled in as Obsidian fills a daily
   * note's (and Periodic Notes a week's): {{date}}, {{yesterday}} and
   * {{tomorrow}} in the notes' name format `form`, {{title}}, {{weekday}},
   * {{sunday:FORMAT}} … {{saturday}} for the days of its week, and
   * {{date:FORMAT}}, {{date+1d}}; a written \n starts a line.
   */
  function fillNote(template, day, options) {
    var form = options.format;
    var language = options.language;
    var name = function (days) {
      return format(
        new Date(day.getFullYear(), day.getMonth(), day.getDate() + days),
        form,
        language,
      );
    };
    var values = Object.assign(
      weekDays(day, language),
      {
        title: options.title,
        weekday: day.toLocaleDateString(language, { weekday: "long" }),
        yesterday: name(-1),
        tomorrow: name(1),
      },
      options.values,
    );
    return fill(template, {
      day: day,
      now: options.now,
      dateFormat: form,
      language: language,
      values: values,
    }).replace(/\\n/g, "\n");
  }

  /** The note of `date` named in `form` in the folder `folder` ("" for the
   *  top), as a "/"-separated path. */
  function notePath(folder, form, date, language) {
    return (folder ? folder + "/" : "") + format(date, form, language) + ".md";
  }

  root.dates = {
    format: format,
    day: day,
    parse: parse,
    fill: fill,
    fillNote: fillNote,
    notePath: notePath,
    weekDays: weekDays,
  };
})(__textusText);

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
