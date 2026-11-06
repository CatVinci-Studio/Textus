//! Which genre a request calls for, and how long: one tool-less step that
//! reads the request before any research, so a topic is written as the
//! piece it asks for - a paper, a review, a report - without the user
//! having to say.

use super::Genre;
use crate::ai::agent::{ask, Model};
use serde_json::Value;

/// The genre and length in characters `request` calls for. `asked` is the
/// length the user picked, if any, kept when it suits the genre; a reply
/// that can't be read keeps the paper.
pub(crate) async fn choose(model: &dyn Model, request: &str, asked: Option<u32>) -> (Genre, u32) {
    let genres: Vec<String> = Genre::ALL
        .iter()
        .map(|g| {
            let p = g.profile();
            format!(
                "- \"{}\": {}; {}-{} characters",
                p.name, p.when, p.chars.0, p.chars.1
            )
        })
        .collect();
    let instructions = format!(
        "You decide what kind of piece a writing request calls for, before it is researched and written. The kinds:\n{}\n\nChoose by what the user asked for and who will read it; when the request names a kind or a length, follow it. A thread is only for a request that asks for social-network posts; news, a press release or a briefing is a brief, or a report when it asks for depth. A review of the literature is a review, not a paper; a report for decision-makers, with data and recommendations, is an analysis, and a long read for the public a report. {length} Reply with a JSON object {{\"genre\": …, \"chars\": …}} and nothing else.",
        genres.join("\n"),
        length = match asked {
            Some(asked) => format!("The user picked about {asked} characters: keep that if it suits the kind, else choose a length within the kind's."),
            None => "Choose a length within the kind's that the topic needs.".to_string(),
        },
    );
    let reply = ask(model, &instructions, format!("Request: {request}"), &|_| {})
        .await
        .unwrap_or_default();
    read(&reply, asked)
}

/// The genre and length in `reply`, fitted to the genre's lengths.
pub(crate) fn read(reply: &str, asked: Option<u32>) -> (Genre, u32) {
    let parsed: Value = crate::ai::json_reply::object(reply).unwrap_or_default();
    let genre = parsed["genre"]
        .as_str()
        .and_then(|name| Genre::ALL.into_iter().find(|g| g.profile().name == name));
    let Some(genre) = genre else {
        return (Genre::Paper, Genre::Paper.length(asked));
    };
    let chars = parsed["chars"].as_u64().map(|c| c as u32).or(asked);
    (genre, genre.length(chars))
}
