use super::*;
use std::process::Command as StdCommand;

/// A user's own sshd on a free port in `dir`, with a client config naming
/// it `testbox`; None where there is no sshd.
fn local_sshd(dir: &Path) -> Option<(std::process::Child, std::path::PathBuf)> {
    let sshd = ["/usr/sbin/sshd", "/usr/bin/sshd"]
        .into_iter()
        .find(|p| Path::new(p).exists())?;
    let keygen = |name: &str| {
        StdCommand::new("ssh-keygen")
            .args(["-q", "-t", "ed25519", "-N", "", "-f"])
            .arg(dir.join(name))
            .status()
            .ok()
            .filter(|s| s.success())
    };
    keygen("host_key")?;
    keygen("client_key")?;
    std::fs::copy(dir.join("client_key.pub"), dir.join("authorized_keys")).ok()?;
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .ok()?
        .local_addr()
        .ok()?
        .port();
    let d = dir.display();
    std::fs::write(
        dir.join("sshd_config"),
        format!(
            "Port {port}\nListenAddress 127.0.0.1\nHostKey {d}/host_key\nAuthorizedKeysFile {d}/authorized_keys\nPidFile {d}/sshd.pid\nUsePAM no\nStrictModes no\nPasswordAuthentication no\nSubsystem sftp internal-sftp\n"
        ),
    )
    .ok()?;
    let host_key = std::fs::read_to_string(dir.join("host_key.pub")).ok()?;
    let key: Vec<&str> = host_key.split_whitespace().take(2).collect();
    std::fs::write(
        dir.join("known_hosts"),
        format!("[127.0.0.1]:{port} {}\n", key.join(" ")),
    )
    .ok()?;
    let user = std::env::var("USER").ok()?;
    let config = dir.join("ssh_config");
    std::fs::write(
        &config,
        format!(
            "Host testbox\n  HostName 127.0.0.1\n  Port {port}\n  User {user}\n  IdentityFile {d}/client_key\n  IdentitiesOnly yes\n  UserKnownHostsFile {d}/known_hosts\n  StrictHostKeyChecking yes\nHost stranger\n  HostName 127.0.0.1\n  Port {port}\n  User {user}\n  IdentityFile {d}/client_key\n  UserKnownHostsFile {d}/none\n"
        ),
    )
    .ok()?;
    let child = StdCommand::new(sshd)
        .args(["-D", "-e", "-f"])
        .arg(dir.join("sshd_config"))
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    std::thread::sleep(std::time::Duration::from_millis(500));
    Some((child, config))
}

#[tokio::test]
#[ignore = "starts a local sshd"]
async fn reads_and_writes_a_folder_on_a_server_and_names_an_unknown_host() {
    let dir = tempfile::tempdir().unwrap();
    let Some((mut sshd, config)) = local_sshd(dir.path()) else {
        return;
    };
    let notes = dir.path().join("notes");
    std::fs::create_dir_all(&notes).unwrap();
    std::fs::write(notes.join("a.md"), "# A\n").unwrap();
    let root = notes.to_string_lossy().into_owned();

    let session = connect("a.ssh", "testbox", Some(&config)).await.unwrap();
    let listed = plugin_ssh_list("a.ssh".into(), session, root.clone())
        .await
        .unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "a.md");
    // Another plugin can't use the link.
    assert!(plugin_ssh_list("b.other".into(), session, root.clone())
        .await
        .is_err());
    let b = format!("{root}/b.md");
    plugin_ssh_create("a.ssh".into(), session, b.clone(), false)
        .await
        .unwrap();
    assert!(plugin_ssh_create("a.ssh".into(), session, b.clone(), false)
        .await
        .is_err());
    plugin_ssh_write("a.ssh".into(), session, b.clone(), "Hello".into(), false)
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(notes.join("b.md")).unwrap(),
        "Hello"
    );
    let c = format!("{root}/c.md");
    plugin_ssh_rename("a.ssh".into(), session, b.clone(), c.clone())
        .await
        .unwrap();
    assert!(notes.join("c.md").exists() && !notes.join("b.md").exists());
    plugin_ssh_remove("a.ssh".into(), session, c).await.unwrap();
    assert!(!notes.join("c.md").exists());
    assert!(plugin_ssh_list("a.ssh".into(), session, "notes".into())
        .await
        .is_err());
    plugin_ssh_close("a.ssh".into(), None).await.unwrap();
    assert!(plugin_ssh_list("a.ssh".into(), session, root)
        .await
        .is_err());

    // A host whose key isn't known: refused, never accepted for the user.
    let err = connect("a.ssh", "stranger", Some(&config))
        .await
        .unwrap_err();
    assert!(err.starts_with(link::UNKNOWN_HOST), "{err}");
    let _ = sshd.kill();
}
