//! English rules. Automatic has no national norm, so conventions style guides
//! disagree on (serial comma, dashes, quotes, -ize/-ise) are checked for
//! consistency only unless the user chooses a preset.

use super::stats::{minority, EN_SPELLING};
use super::text::*;
use super::{Block, Ctx, Out};
use regex::Regex;
use std::sync::LazyLock;

mod spelling;
pub(crate) use spelling::*;
mod punctuation;
pub(crate) use punctuation::*;
mod style;
pub(crate) use style::*;

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    misspelling(t, ctx, out);
    apostrophe_plural(t, ctx, out);
    double_hyphen(t, ctx, out);
    article(t, ctx, out);
    heading_end(t, ctx, out);
    spelling_variety(t, ctx, out);
    serial_comma(t, ctx, out);
    dash_style(t, ctx, out);
    quote_style(t, ctx, out);
    sentence_start(t, ctx, out);
    clock(t, ctx, out);
    etc(t, ctx, out);
    phrases(t, ctx, out);
    caps(t, ctx, out);
    sentence_length(t, ctx, out);
    passive(t, ctx, out);
    ai_vocab(t, ctx, out);
    minus(t, ctx, out);
    slash(t, ctx, out);
}

#[cfg(test)]
mod tests;
