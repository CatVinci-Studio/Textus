//! Japanese rules (CATALOGUE.md §3.5), JTF style by default (ja/jtf),
//! with the 公用文 (koyobun), fiction and technical-writing profiles.
//! Never flagged: a missing space between Japanese and Latin text,
//! 「とんでもございません」 deflecting praise, a single … or ― in 公用文,
//! ！？ in fiction or headings. Spaces are never inserted.

use super::stats::{minority, JA_VARIANTS};
use super::text::*;
use super::{Block, Ctx, Out};
use regex::Regex;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

mod notation;
pub(crate) use notation::*;
mod style;
pub(crate) use style::*;

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    width_kana(t, ctx, out);
    halfwidth(t, ctx, out);
    width_alnum(t, ctx, out);
    space_typed(t, ctx, out);
    space_fullwidth(t, ctx, out);
    after_exclaim(t, ctx, out);
    tilde(t, ctx, out);
    counter(t, ctx, out);
    dots_dash(t, ctx, out);
    single_leader(t, ctx, out);
    register_mix(t, ctx, out);
    ranuki(t, ctx, out);
    no_repeat(t, ctx, out);
    double_negative(t, ctx, out);
    redundant(t, ctx, out);
    sentence_length(t, ctx, out);
    period_bracket(t, ctx, out);
    keigo(t, ctx, out);
    choon(t, ctx, out);
    variants(t, ctx, out);
    kanji_digit(t, ctx, out);
}

/// Japanese running text: kana, kanji, Japanese punctuation and brackets.
fn is_ja(c: char) -> bool {
    is_cjk(c) || is_fullwidth_punct(c) || matches!(c, 'ー' | '々' | '〆' | '…' | '―')
}

#[cfg(test)]
mod tests;
