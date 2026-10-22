//! Learn my style: the samples taken from the writer's files and the
//! instructions the style profile is drafted under.

use super::*;

pub(crate) const STYLE_SAMPLE_CHARS: usize = 20_000;

pub(crate) const STYLE_TOTAL_CHARS: usize = 60_000;

/// The user turn of a "Learn my style" request: up to eight picked files,
/// each cut to STYLE_SAMPLE_CHARS, until STYLE_TOTAL_CHARS - shared with the
/// live eval, which feeds it the same files from a scratch folder.
pub(crate) fn style_samples(files: &[String]) -> Result<String, String> {
    let mut samples = String::new();
    for file in files.iter().take(8) {
        if samples.chars().count() >= STYLE_TOTAL_CHARS {
            break;
        }
        let Ok(text) = std::fs::read_to_string(file) else {
            continue;
        };
        let name = Path::new(file)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let excerpt: String = text.chars().take(STYLE_SAMPLE_CHARS).collect();
        samples.push_str(&format!(
            "<sample name=\"{name}\">\n{excerpt}\n</sample>\n\n"
        ));
    }
    if samples.trim().is_empty() {
        return Err("NO_SAMPLES".to_string());
    }
    Ok(samples)
}

/// "Learn my style": the prompt that drafts the style profile from samples.
/// The profile is written in the samples' language, headings included:
/// the author reviews and edits it in a tab right afterwards, and the
/// app's own templates (projectStyleTemplate in src/i18n/locales/) use
/// the same headings in each UI language. The round-2 eval found
/// Chinese samples profiled in English bullets - the earlier prompt fixed
/// English headings, gave only English examples and mentioned the language
/// once, mid-sentence - and bullets that didn't hold for the samples
/// ("about 6-8 paragraphs" for pieces of five and six, "no metaphors" next
/// to a metaphor). The headings come from ui_language.rs, one line for
/// each language that has its own (style-headings/<code>.txt).
pub(crate) fn style_instructions() -> String {
    let headings = crate::ai::ui_language::style_heading_lines();
    format!("You analyse an author's writing so that an AI writing assistant can continue and revise their text in their own voice. You are given samples the author picked as representative. Write their style profile in Markdown.

Write the whole profile in the language the samples are written in - headings, bullets and all: Chinese samples get a Chinese profile, Japanese samples a Japanese one, English samples an English one. The author reads and edits this file, and the assistant follows it. Use exactly these seven sections, in this order, with the headings in that language:

{headings}

Under each heading give 3-6 short, concrete, checkable bullet points drawn from the samples - \"opens paragraphs with a concrete scene, then the claim\", \"句子很短，多数不超过十五个字\", \"uses full-width Chinese punctuation, no em dashes\" - not generic praise or advice. Every bullet must hold for the samples as given: before writing one, check it against every sample - count instead of estimating, name a habit as \"every sample\" or \"always\" only if each sample shows it, and call something absent (metaphors, exclamation marks, a topic) only if no sample uses it. A habit of the samples' content - who they address, what they are about, their tense - is described as a habit, never as a rule for all writing (\"the pieces speak to the reader as 'you'\", not \"never uses I\"). The Never section lists only what no sample does and the author clearly avoids, and contradicts no other bullet. The Examples section quotes 2-3 short representative passages (1-3 sentences each) verbatim from the samples, without adding quotation marks around a passage that already contains them. Output only the profile, in the samples' language.")
}
