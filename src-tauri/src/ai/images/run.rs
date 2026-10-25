//! One request's pictures: the generate_image tool, each picture's job
//! against the request's limit, and what its result tells the model.

use super::*;

/// Where a picture is asked for: the image model resolved to an address and
/// a key - or, for the ChatGPT sign-in, to the app that holds its
/// credential. Owned, so a picture can be made after the call that asked
/// for it has returned.
#[derive(Clone)]
pub(crate) struct ImageJob {
    /// For the ChatGPT sign-in, whose credential is fetched (and refreshed)
    /// per picture.
    pub(crate) app: Option<AppHandle>,
    pub(crate) api: ImageApi,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
}

/// One request's image model, and how many pictures it has asked for, of
/// how many it may.
pub struct ImageRun {
    pub(crate) job: ImageJob,
    pub(crate) made: AtomicUsize,
    pub(crate) limit: usize,
    /// The document's folder: a picture being redone is read from there,
    /// for a service that changes it rather than draws anew
    /// (ImageApi::takes_reference).
    pub(crate) folder: Option<std::path::PathBuf>,
}

impl ImageRun {
    /// None - and no generate_image tool - without an image model, or
    /// without the key it needs. (Review mode, which changes nothing, never
    /// offers it: ToolRegistry::add.)
    pub fn resolve(
        app: &AppHandle,
        choice: Option<&ImageModel>,
        chat_provider: &str,
    ) -> Option<Self> {
        let choice = choice?;
        let entry = if choice.provider == FOLLOW_CHAT {
            find(following_chat(
                chat_provider,
                crate::auth::openai_codex::signed_in(app),
            )?)?
        } else {
            find(&choice.provider)?
        };
        if entry.api == ImageApi::ChatGpt {
            // Signed in with ChatGPT, or no generate_image at all.
            return crate::auth::openai_codex::signed_in(app).then(|| Self {
                job: ImageJob {
                    app: Some(app.clone()),
                    api: entry.api,
                    base_url: String::new(),
                    api_key: String::new(),
                    model: entry.models[0].to_string(),
                },
                made: AtomicUsize::new(0),
                limit: per_send(choice.limit),
                folder: None,
            });
        }
        let model = Some(choice.model.trim())
            // One of this service's own (a model kept from another service, as
            // following the chat provider can leave, is not), or any typed for
            // the compatible endpoint.
            .filter(|m| !m.is_empty() && (entry.models.is_empty() || entry.models.contains(m)))
            .or_else(|| entry.models.first().copied())?
            .to_string();
        let base_url = entry
            .base_url
            .map(str::to_string)
            .unwrap_or_else(|| choice.base_url.trim().to_string());
        if base_url.is_empty() {
            return None;
        }
        let api_key = crate::auth::keys::load_provider_key(app, entry.key_id)
            .ok()
            .flatten()
            .unwrap_or_default();
        // A compatible endpoint on this computer may need no key.
        if api_key.is_empty() && entry.api != ImageApi::Compatible {
            return None;
        }
        Some(Self {
            job: ImageJob {
                app: None,
                api: entry.api,
                base_url,
                api_key,
                model,
            },
            made: AtomicUsize::new(0),
            limit: per_send(choice.limit),
            folder: None,
        })
    }
}

impl ImageRun {
    /// A request's image model that makes no picture: each one asked for
    /// fails in the background (nothing listens at its address), and
    /// generate_image answers the model as it would for a real one - for
    /// the live picture cases (live_eval::images), which spend nothing on
    /// pictures.
    #[cfg(test)]
    pub(crate) fn offline(limit: usize) -> Self {
        Self {
            job: ImageJob {
                app: None,
                api: ImageApi::OpenAi,
                base_url: "https://127.0.0.1:1".into(),
                api_key: "sk".into(),
                model: "gpt-image-2".into(),
            },
            made: AtomicUsize::new(0),
            limit,
            folder: None,
        }
    }

    /// A request's image model on a real service (`provider` from the
    /// catalog, its cheapest model) with this key: the live picture cases
    /// that pay for their pictures.
    #[cfg(test)]
    pub(crate) fn live(provider: &str, api_key: String, limit: usize) -> Option<Self> {
        let entry = find(provider)?;
        Some(Self {
            job: ImageJob {
                app: None,
                api: entry.api,
                base_url: entry.base_url?.to_string(),
                api_key,
                model: entry.models.last()?.to_string(),
            },
            made: AtomicUsize::new(0),
            limit,
            folder: None,
        })
    }
}

impl ImageRun {
    /// Pictures redone in this request are read from `doc_path`'s folder.
    pub fn in_folder(mut self, doc_path: Option<&str>) -> Self {
        self.folder = doc_path
            .and_then(|p| std::path::Path::new(p).parent())
            .map(std::path::Path::to_path_buf);
        self
    }
}

impl ImageJob {
    /// One picture from the chosen service - `reference` changed as
    /// `prompt` says, where the service takes one.
    pub(crate) async fn generate(
        &self,
        prompt: &str,
        aspect: Aspect,
        reference: Option<&ImageAttachment>,
    ) -> Result<GeneratedImage, gen::ImageError> {
        let Some(app) = self.app.as_ref().filter(|_| self.api == ImageApi::ChatGpt) else {
            return gen::generate(&self.target(), prompt, aspect, reference).await;
        };
        let (access_token, account_id) = crate::auth::openai_codex::get_valid_credential(app)
            .await
            .map_err(|e| {
                gen::ImageError::Failed(format!(
                    "The ChatGPT sign-in isn't usable - sign in again in Settings › Textus AI: {e}"
                ))
            })?;
        aicompat::providers::openai_codex::generate_image(
            &access_token,
            &account_id,
            crate::app_identity::ORIGINATOR,
            prompt,
            aspect,
            reference,
        )
        .await
    }

    pub(crate) fn target(&self) -> ImageTarget<'_> {
        ImageTarget {
            api: self.api,
            base_url: &self.base_url,
            api_key: &self.api_key,
            model: &self.model,
        }
    }
}

impl ImageRun {
    /// One generate_image call's arguments, with what came of it recorded
    /// in them: `image` - the picture's id and its size as asked, while it
    /// is made in the background - or `not_generated` (why not). What the
    /// model may have put under those names is dropped.
    ///
    /// The call returns at once and the reply goes on - its text, and more
    /// pictures - while the picture is made: one took the whole reply's
    /// half a minute to a minute before. The document shows the picture's
    /// frame in place until it comes (ai_generated_image waits for it), or
    /// why it didn't.
    pub(crate) async fn run_call(
        &self,
        arguments: &str,
        document: &crate::ai::doc_blocks::Document,
        proposed: &ProposedText<'_>,
        announce: impl FnOnce(),
    ) -> String {
        let Ok(Value::Object(mut args)) = serde_json::from_str::<Value>(arguments) else {
            return arguments.to_string();
        };
        args.remove("image");
        args.remove("not_generated");
        let outcome = match self.check(&Value::Object(args.clone()), document, proposed) {
            Err(why) => Err(why),
            Ok((prompt, aspect, reference)) => {
                announce();
                Ok(self.start(prompt, aspect, reference))
            }
        };
        match outcome {
            Ok((id, (width, height))) => {
                args.insert(
                    "image".into(),
                    json!({"id": id, "width": width, "height": height, "pending": true}),
                );
            }
            Err(why) => {
                args.insert("not_generated".into(), json!(why));
                // The user is told this one in their language, by its
                // number (ChatMessages' notMadeLine).
                if why == self.limit_reached() {
                    args.insert("limit_reached".into(), json!(self.limit));
                }
            }
        }
        Value::Object(args).to_string()
    }

    /// Starts making one picture in the background; its id, and the size
    /// it is asked for (the frame's shape until it comes).
    pub(crate) fn start(
        &self,
        prompt: String,
        aspect: Aspect,
        reference: Option<Reference>,
    ) -> (String, (u32, u32)) {
        let id = begin();
        make(
            id.clone(),
            std::sync::Arc::new(Asked {
                job: self.job.clone(),
                prompt,
                aspect,
                reference,
            }),
        );
        (id, nominal_size(aspect))
    }

    /// Starts making a picture written into new text (inline), if this
    /// send has pictures left; its id and size, or why not.
    pub(crate) fn begin_picture(
        &self,
        prompt: String,
        aspect: Aspect,
        like: &str,
    ) -> Result<(String, (u32, u32)), String> {
        self.spend()?;
        Ok(self.start(prompt, aspect, self.like(like)))
    }

    /// The picture `like` names, for a new one to keep its people and
    /// style: one in the document by its src, or one proposed before by
    /// its `textus-generated:` src. None where the service takes no
    /// picture, for one not found, and for one still being made - not
    /// waited for, so a picture drawn like another costs only the time to
    /// send it.
    pub(crate) fn like(&self, like: &str) -> Option<Reference> {
        let like = like.trim();
        if like.is_empty() || !self.job.api.takes_reference() {
            return None;
        }
        let picture = match like.strip_prefix("textus-generated:") {
            Some(id) => made_picture(id),
            None => local_picture(&format!("![](<{like}>)"), self.folder.as_deref()?),
        };
        picture.map(Reference::Like)
    }

    /// One of this send's pictures, or why there are none left.
    pub(crate) fn spend(&self) -> Result<(), String> {
        if self.made.fetch_add(1, Ordering::SeqCst) >= self.limit {
            return Err(self.limit_reached());
        }
        Ok(())
    }

    /// What the model is told once this send has made all its pictures.
    fn limit_reached(&self) -> String {
        let limit = self.limit;
        format!("This request has already made {limit} pictures, the most one request may (the user's setting). Ask the user whether they want more.")
    }

    /// The call is fit to spend a picture on: a description, a place that
    /// exists in the document, and pictures left in this send. With the
    /// description and aspect, the picture a `replace` redoes, where the
    /// service takes it.
    pub(crate) fn check(
        &self,
        args: &Value,
        document: &crate::ai::doc_blocks::Document,
        proposed: &ProposedText<'_>,
    ) -> Result<(String, Aspect, Option<Reference>), String> {
        let text = |key: &str| args.get(key).and_then(Value::as_str).unwrap_or("").trim();
        let prompt = text("prompt");
        if prompt.is_empty() {
            return Err("`prompt` is empty - describe the picture.".into());
        }
        let action = text("action");
        if !IMAGE_ACTIONS.contains(&action) {
            return Err(format!(
                "Unknown action `{action}`. Use one of: {}.",
                IMAGE_ACTIONS.join(", ")
            ));
        }
        let mut reference = None;
        if action == "replace" {
            let anchor = text("anchor");
            if !is_picture_markdown(anchor) {
                return Err("`replace` takes `block`, the id of a picture's own block - a picture replaces only a picture; put one next to text with insert_after.".into());
            }
            crate::ai::doc_blocks::check_target(document, args)?;
            reference = self
                .folder
                .as_deref()
                .filter(|_| self.job.api.takes_reference())
                .and_then(|folder| local_picture(anchor, folder))
                .map(Reference::Change);
        }
        if matches!(action, "insert_after" | "insert_before") {
            let anchor = text("anchor");
            // Next to text proposed and not decided yet - which has no
            // block - the picture joins that proposal (useEditorProposals).
            let joins = args.get("block").is_none() && proposed.quotes(anchor);
            if !joins {
                crate::ai::doc_blocks::check_target(document, args)?;
            }
        }
        let aspect = match text("aspect") {
            "" => Aspect::default(),
            ratio => Aspect::parse(ratio).ok_or_else(|| {
                format!(
                    "Unknown aspect `{ratio}`. Use one of: {}.",
                    Aspect::ALL.join(", ")
                )
            })?,
        };
        self.spend()?;
        // A new picture may be drawn like an earlier one; one redone is
        // drawn from itself.
        let reference = reference.or_else(|| self.like(text("like")));
        Ok((prompt.to_string(), aspect, reference))
    }
}

impl ImageRun {
    /// generate_image for this request, offered in Write.
    pub fn tool<'a>(
        &'a self,
        document: &'a crate::ai::doc_blocks::Document,
        proposed: ProposedText<'a>,
        channel: &'a Channel<StreamEvent>,
    ) -> Tool<'a> {
        let proposed = std::sync::Arc::new(proposed);
        Tool {
            spec: spec(self.limit),
            access: Access::ProposesInItsCall,
            modes: EDITING_MODES,
            run: Run::Async(Box::new(move |call| {
                let proposed = proposed.clone();
                Box::pin(async move { self.execute(call, document, &proposed, channel).await })
            })),
        }
    }

    /// Runs one generate_image call: the picture is made (or why not is
    /// said) and recorded in the call's arguments, which is where the
    /// frontend shows the proposal from (ToolRun::Amending). Async like any
    /// tool, so the chat's Stop drops a picture being made.
    pub(crate) async fn execute(
        &self,
        call: ToolCall,
        document: &crate::ai::doc_blocks::Document,
        proposed: &ProposedText<'_>,
        channel: &Channel<StreamEvent>,
    ) -> ToolOutput {
        // The provider may not have streamed the call's start; the
        // frontend says "Generating an image…" from this.
        let announce = || {
            let _ = channel.send(StreamEvent::ToolStart {
                call_id: call.call_id.clone(),
                name: call.name.clone(),
            });
        };
        let arguments = self
            .run_call(&call.arguments, document, proposed, announce)
            .await;
        ToolOutput {
            text: outcome(&arguments),
            call_arguments: Some(arguments),
            ..ToolOutput::default()
        }
    }
}

/// What the model is told about generate_image, with this request's limit.
pub(crate) fn description(limit: usize) -> String {
    let (scheme, aspects) = (inline::PICTURE_SCHEME, Aspect::ALL.join(" "));
    format!("Make a picture with the user's image model and propose it for the document: the user sees it in place, and it is saved only if they accept. Use it when the user asks for a picture, an illustration, a figure or a cover - not for charts or diagrams you can write as Markdown or Mermaid. Write `prompt` as a full visual description in English: subject, setting, composition, style, light and colours, and no text in the picture unless asked.\n\nHow many: each picture costs the user money, and this request may make at most {limit}. When the user says how many, make that many (up to {limit}); when they don't, make one, or - for a longer piece they asked to illustrate - one for each part that gains from a picture.\n\nNew text with pictures (an empty document, a new section, a piece to write and illustrate): don't call generate_image - write each picture into the text you propose with propose_edit, as a line of its own between paragraphs where it goes: `![alt]({scheme}ASPECT description)` - alt a short caption in the document's language, ASPECT one of {aspects}, then the full English description, as for `prompt`. Each picture starts being made the moment its line is written, while you go on writing; the user sees its frame there and accepts the text and its pictures together. These lines count toward the limit, and each describes a different picture.\n\nThe same people, the same look: when a person, an animal or a place appears in more than one picture, describe them in the same words each time - age, face, hair, build, clothes, colours - and keep one style for the whole piece. When an earlier picture shows them, name it: `like` its src (in a picture line, `like:SRC` right after ASPECT, as in `![alt]({scheme}16:9 like:assets/lin.png description)`); the image model is then given that picture to keep them as they are. Only when someone recurs - it makes the picture a little slower.\n\nA picture for text already in the document goes insert_after the block it illustrates, named by its id as `block`; for text you proposed that the user hasn't accepted or rejected yet, quote `anchor` from that text instead. Between paragraphs, never inside a list, a table, a quote or a heading's line, and not two pictures in a row.\n\nRedoing a picture: to change or replace one already in the document, use `replace` with `block` the picture's id, and describe the new picture in full in `prompt` (what to keep, what to change); where the image model can, it is given the old picture to change. The user decides whether the old file goes once they accept. When this request also rewrites the text the picture stands in - a translation, a rewrite of its section or of the whole document - the rewrite's `text` keeps the picture's line as it is (a text edit never changes a picture), and the picture is redone here first, in the same reply: `replace` with its `block`, the new picture described in full; then the rewrite.\n\nIf the service refuses the description, tell the user what it said in plain words; don't change the description and try again on your own.")
}

/// What the model is told about generate_image.
pub(crate) fn spec(limit: usize) -> ToolSpec {
    ToolSpec {
        name: GENERATE_IMAGE_TOOL_NAME.into(),
        description: description(limit).into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "What the picture shows, in English, in detail."
                },
                "alt": {
                    "type": "string",
                    "description": "A short description of the picture for its alt text, in the document's language."
                },
                "aspect": {
                    "type": "string",
                    "enum": Aspect::ALL,
                    "description": "Width to height. Default 1:1."
                },
                "action": {
                    "type": "string",
                    "enum": IMAGE_ACTIONS,
                    "description": "Where it goes: insert_after a paragraph (the usual place for an illustration of existing text), insert_before one, insert_at_cursor, append - or replace a picture already in the document."
                },
                "block": {
                    "type": "string",
                    "description": "For insert_after and insert_before: the id of the block the picture goes next to, like `k3f9` from `[#k3f9]`. For replace: the picture's own block id."
                },
                "anchor": {
                    "type": "string",
                    "description": "Only next to text proposed and not decided yet, which has no id: its last sentence, verbatim."
                },
                "like": {
                    "type": "string",
                    "description": "Only when someone or something recurs: the src of an earlier picture showing them - a picture in the document, or `textus-generated:ID` proposed before - to keep them and the style as they are there."
                }
            },
            "required": ["prompt", "alt", "action"],
        }),
    }
}

/// What the model is told came of its call - read off what
/// ImageRun::execute recorded in the arguments.
pub(crate) fn outcome(arguments: &str) -> String {
    let args: Value = serde_json::from_str(arguments).unwrap_or_default();
    if let Some(image) = args.get("image") {
        let size = format!(
            "{} x {}",
            image["width"].as_u64().unwrap_or(0),
            image["height"].as_u64().unwrap_or(0)
        );
        // Its Markdown, for a later rewrite of the text it stands by to
        // carry it before the user decides on it.
        let alt = args["alt"].as_str().unwrap_or("").replace(['[', ']'], "");
        let markdown = format!(
            "![{}]({})",
            alt.split_whitespace().collect::<Vec<_>>().join(" "),
            placeholder_src(image["id"].as_str().unwrap_or(""))
        );
        let carry = format!(" Until the user decides on it, its Markdown is {markdown}: if you rewrite the paragraph it stands by, put that line in your new text where the picture goes.");
        if image["pending"].as_bool() == Some(true) {
            return format!("Image proposed and being made ({size} pixels) while you go on, and appears in place by itself with Accept and Reject once it is ready (or, if the service turns it down, the user sees why there). It is saved only if they accept. Carry on with the rest of the request now - don't wait for it. In your reply, say in a sentence what it shows and where it goes; don't repeat the prompt.{carry}");
        }
        return format!("Image proposed - the user now sees the picture ({size} pixels) in the document with Accept and Reject; it is saved only if they accept. In your reply, say in a sentence what it shows and where it goes; don't repeat the prompt.{carry}");
    }
    let why = args
        .get("not_generated")
        .and_then(Value::as_str)
        .unwrap_or("there is no image model set up for this request");
    format!("Not generated: {why} Tell the user in plain words; don't change the description and call again unless they ask.")
}
