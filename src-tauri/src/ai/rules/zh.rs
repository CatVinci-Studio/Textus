//! Chinese rules: the region-neutral ones for both scripts, and the mainland
//! (GB/T) ones. Messages are in Chinese, in the script of the text.

use super::stats::minority;
use super::text::*;
use super::zhdata;
use super::{Ctx, Lang, Out};
use regex::Regex;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

mod spacing;
pub(crate) use spacing::*;
mod punctuation;
pub(crate) use punctuation::*;
mod numbers;
pub(crate) use numbers::*;
mod wording;
pub(crate) use wording::*;

/// A message in the text's script: (Simplified, Traditional).
fn m(ctx: &Ctx, hans: &str, hant: &str) -> String {
    if ctx.lang == Lang::ZhHant {
        hant.to_string()
    } else {
        hans.to_string()
    }
}

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    let mainland = ctx.profile.mainland();
    halfwidth(t, ctx, out);
    fullwidth_adjacent(t, ctx, out);
    ellipsis(t, ctx, out);
    ellipsis_deng(t, ctx, out);
    stacked(t, ctx, out);
    heading_end(t, ctx, out);
    cjk_latin(t, ctx, out);
    width_alnum(t, ctx, out);
    decimal(t, ctx, out);
    mixed_date(t, ctx, out);
    short_year(t, ctx, out);
    date_dunhao(t, ctx, out);
    typo(t, ctx, out);
    unit_space(t, ctx, out);
    ascii_range(t, ctx, out);
    compat_ideograph(t, ctx, out);
    clause_length(t, ctx, out);
    if mainland {
        dash(t, ctx, out);
        quote_straight(t, ctx, out);
        approx(t, ctx, out);
        title_dunhao(t, ctx, out);
        mixed_unit(t, ctx, out);
        middot(t, ctx, out);
        gongwen(t, ctx, out);
        ad(t, ctx, out);
    }
    if ctx.lang == Lang::ZhHans {
        variant(t, ctx, out);
        script_mixed(t, ctx, out);
    }
    if ctx.lang == Lang::ZhHant {
        super::tw::run(t, ctx, out);
    }
}

#[cfg(test)]
mod tests;
