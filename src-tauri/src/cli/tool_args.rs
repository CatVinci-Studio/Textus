//! Plugins' AI tools as terminal commands: `textus <plugin> <tool>` with
//! `--name value` options read against the tool's JSON schema.

use serde_json::{Map, Value};

/// A request's command for a plugin's word: `plugin:<word>`.
pub const PLUGIN_PREFIX: &str = "plugin:";

/// The request `textus help` sends for the plugin commands' lines.
pub const LIST_TOOLS: &str = "help:plugins";

pub use crate::plugins::ai_tools::short_name;

/// A tool's arguments from the command line: `--name value`, `--name=value`,
/// a bare `--name` for a boolean, and `--json '{...}'` for all at once.
/// Values are read as the schema's type says.
pub fn arguments(schema: &Value, args: &[String]) -> Result<Value, String> {
    let properties = schema.get("properties").and_then(Value::as_object);
    let mut out = Map::new();
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        let Some(option) = arg.strip_prefix("--") else {
            return Err(format!(
                "'{arg}' isn't an option: give arguments as --<name> <value>."
            ));
        };
        let (name, inline) = match option.split_once('=') {
            Some((name, value)) => (name, Some(value.to_string())),
            None => (option, None),
        };
        if name == "json" {
            let text = inline.or_else(|| rest.next().cloned()).unwrap_or_default();
            match serde_json::from_str::<Value>(&text) {
                Ok(Value::Object(map)) => out.extend(map),
                _ => return Err("--json needs a JSON object.".into()),
            }
            continue;
        }
        let kind = match properties {
            Some(props) => props
                .get(name)
                .ok_or_else(|| format!("This tool has no option --{name}."))?
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("string"),
            None => "string",
        };
        let value = match inline {
            Some(value) => value,
            None if kind == "boolean" => {
                out.insert(name.to_string(), Value::Bool(true));
                continue;
            }
            None => rest
                .next()
                .cloned()
                .ok_or_else(|| format!("--{name} needs a value."))?,
        };
        out.insert(name.to_string(), typed(kind, &value, name)?);
    }
    let missing: Vec<&str> = schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|name| !out.contains_key(*name))
        .collect();
    if !missing.is_empty() {
        return Err(format!("Missing: --{}.", missing.join(", --")));
    }
    Ok(Value::Object(out))
}

fn typed(kind: &str, value: &str, name: &str) -> Result<Value, String> {
    let wrong = || format!("--{name} needs a {kind}.");
    Ok(match kind {
        "integer" => Value::from(value.parse::<i64>().map_err(|_| wrong())?),
        "number" => Value::from(value.parse::<f64>().map_err(|_| wrong())?),
        "boolean" => Value::Bool(value.parse().map_err(|_| wrong())?),
        "array" | "object" => serde_json::from_str(value).map_err(|_| wrong())?,
        _ => Value::String(value.to_string()),
    })
}

/// `textus <plugin> <tool> --a <string> [--b <number>]`, then what it does.
pub fn usage(plugin: &str, tool: &str, description: &str, schema: &Value) -> String {
    let required: Vec<&str> = schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let mut line = format!("Usage: textus {} {tool}", short_name(plugin));
    if let Some(props) = schema.get("properties").and_then(Value::as_object) {
        for (name, prop) in props {
            let kind = prop.get("type").and_then(Value::as_str).unwrap_or("string");
            let option = format!("--{name} <{kind}>");
            if required.contains(&name.as_str()) {
                line.push_str(&format!(" {option}"));
            } else {
                line.push_str(&format!(" [{option}]"));
            }
        }
    }
    format!(
        "{line}\n\n{}\n\nA tool of the plugin {plugin}. Also: --json '<object>'.\n",
        description.trim()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "text": { "type": "string" },
                "limit": { "type": "integer" },
                "exact": { "type": "boolean" }
            },
            "required": ["text"]
        })
    }

    #[test]
    fn options_are_read_as_the_schema_types_them() {
        let got = arguments(
            &schema(),
            &args(&["--text", "hello world", "--limit=3", "--exact"]),
        )
        .unwrap();
        assert_eq!(
            got,
            json!({ "text": "hello world", "limit": 3, "exact": true })
        );
    }

    #[test]
    fn json_gives_every_argument_at_once() {
        let got = arguments(&schema(), &args(&["--json", r#"{"text":"a","limit":2}"#])).unwrap();
        assert_eq!(got, json!({ "text": "a", "limit": 2 }));
    }

    #[test]
    fn a_wrong_option_or_value_is_refused_with_why() {
        assert!(arguments(&schema(), &args(&["--text", "a", "--nope", "1"]))
            .unwrap_err()
            .contains("--nope"));
        assert!(
            arguments(&schema(), &args(&["--text", "a", "--limit", "many"]))
                .unwrap_err()
                .contains("integer")
        );
        assert_eq!(
            arguments(&schema(), &args(&["--limit", "1"])).unwrap_err(),
            "Missing: --text."
        );
    }

    #[test]
    fn the_command_is_named_for_the_plugin_as_the_model_names_it() {
        assert_eq!(short_name("catvinci.word-count"), "word-count");
        let text = usage("catvinci.word-count", "count", "Counts words.", &schema());
        assert!(text.starts_with(
            "Usage: textus word-count count [--exact <boolean>] [--limit <integer>] --text <string>"
        ));
    }
}
