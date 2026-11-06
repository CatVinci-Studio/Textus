//! What the paper's stages tell the model, kept as text apart from the
//! code: one Markdown file a stage in prompts/, compiled in. A file's
//! `## name` headings each begin a prompt, `<file>.<name>`, which runs to
//! the next heading, kept as written but for the blank lines around it;
//! what comes before the first heading is a note for whoever edits the
//! file. A prompt's `{{name}}` is filled in by the code from what it knows
//! at the time - the paper, its notes, its outline; a lone brace is just a
//! brace, as in the JSON a prompt asks for.

use std::collections::HashMap;
use std::fmt::Display;
use std::sync::OnceLock;

/// Every prompt file, by its name.
const FILES: &[(&str, &str)] = &[
    ("choose", include_str!("prompts/choose.md")),
    ("finish", include_str!("prompts/finish.md")),
];

/// The prompts in `text`, the file `file`, by their full names.
fn parse(file: &str, text: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for line in text.split('\n') {
        if let Some(name) = line.strip_prefix("## ") {
            out.push((format!("{file}.{}", name.trim()), String::new()));
        } else if let Some((_, body)) = out.last_mut() {
            body.push_str(line);
            body.push('\n');
        }
    }
    for (_, body) in &mut out {
        *body = body.trim_matches('\n').to_string();
    }
    out
}

fn all() -> &'static HashMap<String, String> {
    static ALL: OnceLock<HashMap<String, String>> = OnceLock::new();
    ALL.get_or_init(|| {
        FILES
            .iter()
            .flat_map(|(file, text)| parse(file, text))
            .collect()
    })
}

/// The prompt `name` ("draft.instructions"). Every name the code asks for
/// is in a file: the tests ask for each.
pub(crate) fn get(name: &str) -> &'static str {
    match all().get(name) {
        Some(text) => text,
        None => panic!("no prompt {name:?} in src-tauri/src/ai/paper/prompts"),
    }
}

/// The prompt `name` with each `{{key}}` in it filled in from `values`.
pub(crate) fn fill(name: &str, values: &[(&str, &dyn Display)]) -> String {
    render(get(name), values)
}

/// `template` with each `{{key}}` filled in. A key with no value, or a
/// value no key takes, is a mistake in the prompt or in its caller: the
/// tests fail on it, and the app leaves the key as it is.
pub(crate) fn render(template: &str, values: &[(&str, &dyn Display)]) -> String {
    let mut out = String::with_capacity(template.len() + 256);
    let mut used = vec![false; values.len()];
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            out.push_str(&rest[start..]);
            rest = "";
            break;
        };
        let key = &after[..end];
        match values.iter().position(|(k, _)| *k == key) {
            Some(i) => {
                used[i] = true;
                out.push_str(&values[i].1.to_string());
            }
            None => {
                debug_assert!(false, "the prompt's {{{{{key}}}}} has no value");
                out.push_str(&rest[start..start + end + 4]);
            }
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    if let Some(i) = used.iter().position(|u| !u) {
        debug_assert!(
            false,
            "no {{{{{}}}}} in the prompt takes its value",
            values[i].0
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_s_headings_begin_its_prompts() {
        let found = parse(
            "stage",
            "A note for editors.\n\n## one\n\nFirst {{x}}.\n\n## two\nLine\n\nand more\n\n",
        );
        assert_eq!(
            found,
            vec![
                ("stage.one".to_string(), "First {{x}}.".to_string()),
                ("stage.two".to_string(), "Line\n\nand more".to_string()),
            ]
        );
    }

    #[test]
    fn a_template_is_filled_by_name_and_keeps_its_braces() {
        let n = 3;
        assert_eq!(
            render(
                "{{n}} of {{what}}, as {\"a\": 1} - {{n}} again",
                &[("n", &n), ("what", &"them")]
            ),
            "3 of them, as {\"a\": 1} - 3 again"
        );
        assert_eq!(render("no keys", &[]), "no keys");
        assert_eq!(render("{{open", &[]), "{{open");
    }

    #[test]
    #[should_panic(expected = "has no value")]
    fn a_key_with_no_value_is_a_mistake() {
        render("{{missing}}", &[]);
    }

    #[test]
    #[should_panic(expected = "takes its value")]
    fn a_value_no_key_takes_is_a_mistake() {
        render("nothing", &[("extra", &1)]);
    }

    #[test]
    fn every_prompt_file_is_read() {
        for (file, text) in FILES {
            let found = parse(file, text);
            assert!(!found.is_empty(), "{file}.md has no ## prompts");
            for (name, body) in found {
                assert!(!body.is_empty(), "{name} is empty");
            }
        }
    }
}
