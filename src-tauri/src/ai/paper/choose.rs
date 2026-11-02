//! Which genre a request calls for, and how long: one tool-less step that
//! reads the request before any research, so a topic is written as the
//! piece it asks for - a paper, a report - without the user having to say.

use super::research::Model;
use super::Genre;
use aicompat::agent::{AgentTurn, StepResult};
use serde_json::Value;

/// The genre and length in characters `request` calls for. `asked` is the
/// length the user picked, kept when it suits the genre; a reply that can't
/// be read keeps the paper at that length.
pub(crate) async fn choose(model: &dyn Model, request: &str, asked: u32) -> (Genre, u32) {
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
        "You decide what kind of piece a writing request calls for, before it is researched and written. The kinds:\n{}\n\nChoose by what the user asked for and who will read it; when the request names a kind or a length, follow it. The user picked about {asked} characters: keep that if it suits the kind, else choose a length within the kind's. Reply with a JSON object {{\"genre\": …, \"chars\": …}} and nothing else.",
        genres.join("\n")
    );
    let reply = match model
        .step(
            &instructions,
            &[AgentTurn::User {
                text: format!("Request: {request}"),
                images: Vec::new(),
            }],
            &[],
        )
        .await
    {
        Ok(StepResult::Done(text)) => text,
        _ => String::new(),
    };
    read(&reply, asked)
}

/// The genre and length in `reply`, fitted to the genre's lengths.
pub(crate) fn read(reply: &str, asked: u32) -> (Genre, u32) {
    let parsed: Value = reply
        .find('{')
        .zip(reply.rfind('}'))
        .and_then(|(a, b)| serde_json::from_str(reply.get(a..=b)?).ok())
        .unwrap_or_default();
    let genre = parsed["genre"]
        .as_str()
        .and_then(|name| Genre::ALL.into_iter().find(|g| g.profile().name == name));
    let Some(genre) = genre else {
        return (Genre::Paper, Genre::Paper.fit(asked));
    };
    let chars = parsed["chars"].as_u64().map_or(asked, |c| c as u32);
    (genre, genre.fit(chars))
}
