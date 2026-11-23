//! A rewrite's pictures: a text edit never changes a picture, so
//! `keep_pictures` puts back the ones a rewrite left out or swapped.

use super::paragraphs;
use regex::Regex;
use std::sync::LazyLock;

/// Whether `block` is a picture and nothing else: `![alt](path)` or an
/// `<img>`. Keep in step with the frontend's isPicture (shared cases file).
pub(super) fn is_picture(block: &str) -> bool {
    let b = block.trim();
    if b.contains('\n') {
        return false;
    }
    if let Some(rest) = b.strip_prefix("![") {
        // `![alt](path)`: no `]` in the alt, no `)` in the path.
        return match rest.find(']') {
            Some(close) => rest[close + 1..]
                .strip_prefix('(')
                .and_then(|r| r.strip_suffix(')'))
                .is_some_and(|path| !path.contains(')')),
            None => false,
        };
    }
    b.strip_prefix("<img")
        .and_then(|r| r.strip_suffix('>'))
        .is_some_and(|attrs| attrs.starts_with(char::is_whitespace) && !attrs.contains('>'))
}

/// A picture's address: what makes it the same picture whatever its
/// description says. `![alt](<a b.png> "title")` is `a b.png`. Keep in step
/// with the frontend's pictureSrc.
pub(super) fn picture_src(picture: &str) -> Option<String> {
    static MARKDOWN: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^!\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]*)").unwrap());
    static IMG: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"(?i)^<img\s[^>]*\bsrc\s*=\s*["']([^"']*)["']"#).unwrap());
    let t = picture.trim();
    if let Some(m) = MARKDOWN.captures(t) {
        return Some(unbracket(&m[1]).to_string());
    }
    IMG.captures(t).map(|m| m[1].to_string())
}

/// An address as written in `<>`, without them.
fn unbracket(src: &str) -> &str {
    src.strip_prefix('<')
        .and_then(|s| s.strip_suffix('>'))
        .unwrap_or(src)
}

/// `original` with the description `rewritten` gives it: the writer's address
/// and title stay. An `<img>` stays as it is.
fn with_description(original: &str, rewritten: &str) -> String {
    static ALT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^!\[([^\]\n]*)\]\(").unwrap());
    static REST: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^!\[[^\]\n]*\](\(.*\))$").unwrap());
    match (
        ALT.captures(rewritten.trim()),
        REST.captures(original.trim()),
    ) {
        (Some(alt), Some(rest)) => format!("![{}]{}", &alt[1], &rest[1]),
        _ => original.trim().to_string(),
    }
}

/// `text` with each line that is one of `srcs`' pictures in a paragraph of
/// other lines put in a paragraph of its own, as the writer's picture is:
/// "![a](a.png)\n*Figure 1*" would read as one paragraph, the picture beside
/// its caption.
fn pictures_apart(text: &str, srcs: &[&str]) -> String {
    let apart = |line: &str| {
        is_picture(line) && picture_src(line).is_some_and(|s| srcs.contains(&s.as_str()))
    };
    let mut out = text.to_string();
    for (from, to) in paragraphs(text).into_iter().rev() {
        let lines: Vec<&str> = text[from..to].split('\n').collect();
        if lines.len() < 2 || !lines.iter().any(|l| apart(l)) {
            continue;
        }
        let mut groups: Vec<Vec<&str>> = Vec::new();
        for line in lines {
            match groups.last_mut() {
                Some(last) if !apart(line) && !apart(last[0]) => last.push(line),
                _ => groups.push(vec![line]),
            }
        }
        let parts: Vec<String> = groups.iter().map(|g| g.join("\n")).collect();
        out = format!("{}{}{}", &out[..from], parts.join("\n\n"), &out[to..]);
    }
    out
}

/// `text`, a rewrite of `run`, with the run's pictures as they were: a
/// picture is the same by its address, so the rewrite may change its
/// description but never what it shows; a dropped picture goes back by the
/// paragraph it stood by, and a swapped one is taken out and the original put
/// back (the swap is generate_image's to propose). `complete`: all of `text`
/// is there; while streaming, a picture whose place isn't reached yet is left
/// out. Returns the text and how many were taken out. Keep in step with the
/// frontend's keepPictures (shared cases file).
pub(crate) fn keep_pictures(run: &[&str], text: &str, complete: bool) -> (String, usize) {
    static IN_TEXT: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"!\[([^\]]*)\]\((<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\)"#).unwrap()
    });
    let blocks: Vec<&str> = run.iter().map(|b| b.trim()).collect();
    // (index in the run, markdown, address)
    let originals: Vec<(usize, &str, String)> = blocks
        .iter()
        .enumerate()
        .filter(|(_, b)| is_picture(b))
        .filter_map(|(i, b)| picture_src(b).map(|src| (i, *b, src)))
        .collect();
    if originals.is_empty() {
        return (text.to_string(), 0);
    }
    let srcs: Vec<&str> = originals.iter().map(|(_, _, s)| s.as_str()).collect();
    let mut shown: Vec<usize> = Vec::new();
    // The writer's picture the rewrite's `src` is, not taken yet.
    let take = |src: &str, shown: &mut Vec<usize>| {
        let found = originals
            .iter()
            .find(|(i, _, s)| s == src && !shown.contains(i))
            .map(|(i, md, _)| (*i, *md));
        if let Some((i, _)) = found {
            shown.push(i);
        }
        found
    };
    let spaced = pictures_apart(text, &srcs);
    let spans = paragraphs(&spaced);
    // Each paragraph's text, and whether it is one of the writer's pictures.
    let parts: Vec<(String, bool)> = spans
        .iter()
        .map(|&(s, e)| {
            let p = &spaced[s..e];
            if is_picture(p) {
                return match picture_src(p).and_then(|src| take(&src, &mut shown)) {
                    Some((_, md)) => (with_description(md, p), true),
                    None => (p.to_string(), false),
                };
            }
            // A picture inside the words is shown there.
            for m in IN_TEXT.captures_iter(p) {
                take(unbracket(&m[2]), &mut shown);
            }
            (p.to_string(), false)
        })
        .collect();
    let missing = originals.len() - shown.len();
    let mut swapped = 0;
    let kept: Vec<&(String, bool)> = parts
        .iter()
        .filter(|(p, ours)| {
            let new = !ours
                && is_picture(p)
                && !picture_src(p).is_some_and(|s| srcs.contains(&s.as_str()));
            if new && swapped < missing {
                swapped += 1;
                return false;
            }
            true
        })
        .collect();
    let rewritten = spaced != text
        || swapped > 0
        || parts
            .iter()
            .zip(&spans)
            .any(|((p, _), &(s, e))| p != &spaced[s..e]);
    let mut out = if rewritten {
        kept.iter()
            .map(|(p, _)| p.as_str())
            .collect::<Vec<_>>()
            .join("\n\n")
    } else {
        text.to_string()
    };
    let mut words_before = 0;
    // Pictures in the new text so far: each moves the later places on by one.
    let mut put = 0;
    for (i, picture) in blocks.iter().enumerate() {
        if !originals.iter().any(|(at, _, _)| *at == i) {
            words_before += 1;
            continue;
        }
        // Kept where the rewrite has it, it takes a place all the same.
        if shown.contains(&i) {
            put += 1;
            continue;
        }
        let spans = paragraphs(&out);
        let at = words_before + put;
        out = if at == 0 {
            format!("{picture}\n\n{}", out.trim_start())
        } else if at < spans.len() {
            let end = spans[at - 1].1;
            format!(
                "{}\n\n{picture}\n\n{}",
                &out[..end],
                out[end..].trim_start()
            )
        } else if complete && !spans.is_empty() {
            format!("{}\n\n{picture}", out.trim_end())
        } else {
            continue;
        };
        put += 1;
    }
    (out, swapped)
}
