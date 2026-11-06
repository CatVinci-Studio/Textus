//! Which genre a request calls for, and how long: one tool-less step that
//! reads the request before any research, so a topic is written as the
//! piece it asks for - a paper, a review, a report - without the user
//! having to say.

use super::model::ask;
use super::prompts;
use super::research::Model;
use super::Genre;
use serde_json::Value;

/// The genre and length in characters `request` calls for. `asked` is the
/// length the user picked, if any, kept when it suits the genre; a reply
/// that can't be read keeps the paper.
pub(crate) async fn choose(model: &dyn Model, request: &str, asked: Option<u32>) -> (Genre, u32) {
    let reply = ask(
        model,
        &instructions(asked),
        format!("Request: {request}"),
        &|_| {},
    )
    .await
    .unwrap_or_default();
    read(&reply, asked)
}

/// What the choosing step is told: the genres, and the length the user
/// picked if any.
pub(crate) fn instructions(asked: Option<u32>) -> String {
    let genres: Vec<String> = Genre::ALL
        .iter()
        .map(|g| {
            let p = g.profile();
            prompts::fill(
                "choose.genre",
                &[
                    ("name", &p.name),
                    ("when", &p.when),
                    ("least", &p.chars.0),
                    ("most", &p.chars.1),
                ],
            )
        })
        .collect();
    let length = match asked {
        Some(asked) => prompts::fill("choose.length.asked", &[("asked", &asked)]),
        None => prompts::get("choose.length.open").to_string(),
    };
    prompts::fill(
        "choose.instructions",
        &[("genres", &genres.join("\n")), ("length", &length)],
    )
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
