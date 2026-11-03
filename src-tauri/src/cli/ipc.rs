//! The connection between `textus` and the running app: a Unix socket on
//! macOS and Linux, a named pipe on Windows, both only for this user. The
//! command sends one JSON line; the app answers with lines of output and
//! ends with the exit code.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

/// One command for the app.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub command: String,
    pub args: Vec<String>,
    /// The terminal's folder, for relative paths.
    pub cwd: String,
    pub json: bool,
}

/// One line of the app's answer; `Exit` is the last.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Reply {
    Out(String),
    Err(String),
    Exit(i32),
}

/// What a command in the app came to.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Answer {
    pub out: String,
    pub err: String,
    pub exit: i32,
}

impl Answer {
    pub fn ok(out: impl Into<String>) -> Self {
        Answer {
            out: out.into(),
            ..Default::default()
        }
    }

    pub fn fail(err: impl Into<String>, exit: i32) -> Self {
        Answer {
            err: err.into(),
            exit,
            ..Default::default()
        }
    }

    fn replies(self) -> Vec<Reply> {
        let mut replies = Vec::new();
        if !self.out.is_empty() {
            replies.push(Reply::Out(self.out));
        }
        if !self.err.is_empty() {
            replies.push(Reply::Err(self.err));
        }
        replies.push(Reply::Exit(self.exit));
        replies
    }
}

/// Where the app listens: in its own data folder on macOS, the session's
/// runtime folder on Linux, a pipe named for the user on Windows.
#[cfg(target_os = "macos")]
pub fn endpoint() -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    Some(home.join("Library/Application Support/com.catvinci.textus/cli.sock"))
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn endpoint() -> Option<PathBuf> {
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .or_else(|| Some(PathBuf::from(std::env::var_os("HOME")?).join(".local/share")))?;
    Some(dir.join("com.catvinci.textus/cli.sock"))
}

#[cfg(windows)]
pub fn endpoint() -> Option<PathBuf> {
    let user = std::env::var("USERNAME").unwrap_or_default();
    let safe: String = user
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    Some(PathBuf::from(format!(r"\\.\pipe\textus-cli-{safe}")))
}

#[cfg(unix)]
type Stream = std::os::unix::net::UnixStream;
#[cfg(windows)]
type Stream = std::fs::File;

/// A connection to the running app, or None when none is listening.
pub fn connect() -> Option<Stream> {
    let path = endpoint()?;
    #[cfg(unix)]
    return Stream::connect(path).ok();
    #[cfg(windows)]
    return std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .ok();
}

/// Sends `request` and hands each reply line to `on_reply`; the exit code.
pub fn exchange(
    stream: impl std::io::Read + Write,
    request: &Request,
    mut on_reply: impl FnMut(Reply),
) -> Result<i32, String> {
    let mut reader = BufReader::new(stream);
    let mut line = serde_json::to_string(request).map_err(|e| e.to_string())?;
    line.push('\n');
    reader
        .get_mut()
        .write_all(line.as_bytes())
        .and_then(|()| reader.get_mut().flush())
        .map_err(|e| format!("Textus couldn't be reached: {e}"))?;
    let mut line = String::new();
    loop {
        line.clear();
        let read = reader
            .read_line(&mut line)
            .map_err(|e| format!("Textus stopped answering: {e}"))?;
        if read == 0 {
            return Err("Textus closed the connection without an answer.".into());
        }
        match serde_json::from_str::<Reply>(line.trim_end()) {
            Ok(Reply::Exit(code)) => return Ok(code),
            Ok(reply) => on_reply(reply),
            Err(_) => return Err("Textus answered with something unreadable.".into()),
        }
    }
}

/// The app's side of one connection: reads the request, answers it with
/// `handle` and writes the replies.
pub async fn serve<S, F, Fut>(stream: S, handle: F) -> std::io::Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    F: FnOnce(Request) -> Fut,
    Fut: std::future::Future<Output = Answer>,
{
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
    let mut stream = tokio::io::BufReader::new(stream);
    let mut line = String::new();
    // One request line, bounded, so a stray client can't fill memory.
    let mut limited = AsyncReadExt::take(&mut stream, 1 << 20);
    limited.read_line(&mut line).await?;
    let answer = match serde_json::from_str::<Request>(line.trim_end()) {
        Ok(request) => handle(request).await,
        Err(_) => Answer::fail("Not a request this Textus understands.", 2),
    };
    let stream = stream.get_mut();
    for reply in answer.replies() {
        let mut text = serde_json::to_string(&reply).unwrap_or_default();
        text.push('\n');
        stream.write_all(text.as_bytes()).await?;
    }
    stream.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replies_are_one_json_object_a_line() {
        assert_eq!(
            serde_json::to_string(&Reply::Out("a\nb".into())).unwrap(),
            r#"{"out":"a\nb"}"#
        );
        assert_eq!(
            serde_json::to_string(&Reply::Exit(2)).unwrap(),
            r#"{"exit":2}"#
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_request_round_trips_through_a_handler() {
        let (client, server) = std::os::unix::net::UnixStream::pair().unwrap();
        let app = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(async move {
                server.set_nonblocking(true).unwrap();
                let server = tokio::net::UnixStream::from_std(server).unwrap();
                serve(server, |request: Request| async move {
                    Answer {
                        out: format!("{} {}", request.command, request.args.join(",")),
                        err: "careful".into(),
                        exit: 3,
                    }
                })
                .await
                .unwrap();
            });
        });
        let request = Request {
            command: "theme".into(),
            args: vec!["set".into(), "paper".into()],
            cwd: "/tmp".into(),
            json: false,
        };
        let mut seen = Vec::new();
        let code = exchange(&client, &request, |reply| seen.push(reply)).unwrap();
        app.join().unwrap();
        assert_eq!(code, 3);
        assert_eq!(
            seen,
            vec![
                Reply::Out("theme set,paper".into()),
                Reply::Err("careful".into())
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn an_app_that_hangs_up_is_an_error_not_a_success() {
        let (client, server) = std::os::unix::net::UnixStream::pair().unwrap();
        drop(server);
        let request = Request {
            command: "theme".into(),
            args: vec![],
            cwd: String::new(),
            json: false,
        };
        assert!(exchange(&client, &request, |_| {}).is_err());
    }
}
