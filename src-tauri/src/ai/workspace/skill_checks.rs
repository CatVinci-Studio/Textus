//! What a skill a reply wrote is checked for before it is saved. Its
//! instructions join every later prompt in its modes, so a skill the model
//! wrote is a prompt that persists: the user confirms a second time when it
//! runs in Create mode (where it could write the next skill) or reads like
//! an attempt to override the instructions around it.

use crate::ai::agent::AgentMode;
use regex::Regex;
use std::sync::LazyLock;

/// The error `save_written_in` returns, followed by `:` and the warnings
/// joined by `,`, while they are not confirmed.
pub(crate) const SKILL_NEEDS_CONFIRM: &str = "SKILL_NEEDS_CONFIRM";

/// It applies in Create mode, where it could write or rewrite skills itself.
pub(crate) const WARN_CREATE_MODE: &str = "create-mode";
/// Its instructions read like an attempt to override the ones around them.
pub(crate) const WARN_PROMPT_INJECTION: &str = "prompt-injection";
/// It holds characters a reader can't see: zero-width or direction marks.
pub(crate) const WARN_HIDDEN_TEXT: &str = "hidden-text";

/// Phrasings of "drop the instructions you were given", in English and
/// Chinese, and fake role markers. Matched on lowercased text with its
/// whitespace collapsed.
static INJECTION: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        // ignore / disregard / forget ... previous instructions
        r"\b(?:ignore|disregard|forget|override|bypass|skip)\b(?:\s+\S+){0,3}?\s+(?:previous|prior|above|earlier|preceding|original|system|developer|all|your)\b(?:\s+\S+){0,2}?\s+(?:instructions?|prompts?|rules|directives?|guidelines|guardrails|messages?)\b",
        r"\b(?:reveal|print|show|repeat|output|leak)\b(?:\s+\S+){0,3}?\s+(?:system|developer|hidden)\s+(?:prompt|instructions?|message)",
        r"\b(?:jailbreak|developer mode|dan mode|do anything now)\b",
        r"\byou are no longer\b",
        r"\bnew (?:system )?instructions\s*:",
        // Role markers that pretend a new message starts here.
        r"<\|?(?:im_start|im_end|system|endoftext)\|?>",
        r"</?(?:system|assistant|developer)>",
        r"^\s*(?:\[|#+\s*)(?:system|developer)\b(?:\]|\s*(?:prompt|message)?\s*:)",
        // 忽略 / 无视 / 忘记 ... 之前的指令
        r"(?:忽略|无视|忽视|忘记|忘掉|不要理会|跳过|绕过|覆盖)(?:掉)?(?:你)?(?:之前|以上|上面|前面|先前|此前|上述|原来|原有|原先|所有|全部|一切|系统)[^。\n]{0,8}?(?:指令|指示|提示词?|规则|要求|设定|约束|限制|消息)",
        r"(?:输出|显示|告诉我|泄露|打印|重复)[^。\n]{0,6}?(?:系统提示词?|系统指令|系统消息)",
        r"(?:系统提示词?|系统指令|系统消息)[^。\n]{0,6}?(?:输出|显示|告诉|泄露|打印|重复|发给)",
        r"(?:越狱|开发者模式)",
    ]
    .iter()
    .map(|p| Regex::new(&format!("(?m){p}")).expect("injection pattern"))
    .collect()
});

/// Zero-width spaces and joiners, direction overrides and isolates, soft
/// hyphens, invisible fillers, a byte-order mark, tag characters and the
/// supplementary variation selectors (an emoji's own are left alone): text
/// that reads differently than it shows.
fn is_hidden_char(c: char) -> bool {
    matches!(c,
        '\u{00AD}'
        | '\u{034F}'
        | '\u{115F}'..='\u{1160}'
        | '\u{180E}'
        | '\u{200B}'..='\u{200F}'
        | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{2064}'
        | '\u{2066}'..='\u{2069}'
        | '\u{3164}'
        | '\u{FEFF}'
        | '\u{FFA0}'
        | '\u{E0000}'..='\u{E007F}'
        | '\u{E0100}'..='\u{E01EF}')
}

/// Whether `prompt` reads like it overrides the instructions around it.
pub(crate) fn looks_like_injection(prompt: &str) -> bool {
    let text = prompt
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("\n")
        .to_lowercase();
    INJECTION.iter().any(|re| re.is_match(&text))
}

/// What a user should know before saving a skill with `prompt` (its
/// instructions, comments stripped) in `modes`, most serious first.
pub(crate) fn skill_warnings(prompt: &str, modes: &[AgentMode]) -> Vec<&'static str> {
    let mut warnings = Vec::new();
    if looks_like_injection(prompt) {
        warnings.push(WARN_PROMPT_INJECTION);
    }
    if prompt.chars().any(is_hidden_char) {
        warnings.push(WARN_HIDDEN_TEXT);
    }
    if modes.contains(&AgentMode::Create) {
        warnings.push(WARN_CREATE_MODE);
    }
    warnings
}
