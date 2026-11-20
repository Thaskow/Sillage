use std::collections::HashSet;
use std::path::Path;

use serde_json::Value;
use uuid::Uuid;

use crate::sessions::SessionKind;
use crate::usage::{lines, parse_timestamp, recent_jsonl};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentLaunch {
    pub args: Vec<String>,
    pub session_id: Option<String>,
    pub started_at: Option<i64>,
    pub resumed: bool,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn norm(p: &str) -> String {
    p.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

pub fn claude_transcript_exists(home: &Path, id: &str) -> bool {
    let file = format!("{id}.jsonl");
    std::fs::read_dir(home.join("projects"))
        .map(|it| it.flatten().any(|e| e.path().join(&file).is_file()))
        .unwrap_or(false)
}

pub fn find_codex_session(
    home: &Path,
    cwd: &str,
    since: i64,
    taken: &HashSet<String>,
) -> Option<String> {
    let mut files = vec![];
    recent_jsonl(&home.join("sessions"), since - 60_000, &mut files);
    let want = norm(cwd);
    let mut best: Option<(i64, String)> = None;
    for f in files {
        if !f
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("rollout-"))
        {
            continue;
        }
        let Some(v) = lines(&f)
            .next()
            .and_then(|l| serde_json::from_str::<Value>(&l).ok())
        else {
            continue;
        };
        let p = &v["payload"];
        let (Some(id), Some(dir)) = (p["id"].as_str(), p["cwd"].as_str()) else {
            continue;
        };
        let Some(at) = p["timestamp"]
            .as_str()
            .or_else(|| v["timestamp"].as_str())
            .and_then(parse_timestamp)
        else {
            continue;
        };
        if v["type"] != "session_meta"
            || !valid_id(id)
            || norm(dir) != want
            || at < since - 5_000
            || taken.contains(id)
        {
            continue;
        }
        if best.as_ref().is_none_or(|(t, _)| at < *t) {
            best = Some((at, id.to_string()));
        }
    }
    best.map(|(_, id)| id)
}

fn hook_command(record: &Path, windows: bool) -> (&'static str, String) {
    let path = record.display().to_string();
    if windows {
        let target = path.replace('\'', "''");
        (
            "powershell",
            format!(
                "[Console]::In.ReadToEnd() | Set-Content -LiteralPath '{target}' -Encoding utf8"
            ),
        )
    } else {
        ("bash", format!("cat > '{}'", path.replace('\'', r"'\''")))
    }
}

pub fn claude_hook_settings(record: &Path) -> String {
    let (shell, command) = hook_command(record, cfg!(windows));
    serde_json::json!({
        "hooks": {
            "SessionStart": [{
                "hooks": [{ "type": "command", "shell": shell, "command": command }]
            }]
        }
    })
    .to_string()
}

pub fn recorded_claude_session(record: &Path) -> Option<String> {
    let text = std::fs::read_to_string(record).ok()?;
    let v: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let id = v["session_id"].as_str()?;
    valid_id(id).then(|| id.to_string())
}

pub struct Saved<'a> {
    pub session_id: Option<&'a str>,
    pub started_at: Option<i64>,
}

pub fn plan(
    kind: SessionKind,
    saved: Saved,
    home: Option<&Path>,
    cwd: &str,
    taken: &HashSet<String>,
    now: i64,
) -> Option<AgentLaunch> {
    let saved_id = saved.session_id.filter(|id| valid_id(id));
    match kind {
        SessionKind::Claude => {
            if let (Some(id), Some(h)) = (saved_id, home) {
                if claude_transcript_exists(h, id) {
                    return Some(AgentLaunch {
                        args: vec!["--resume".into(), id.into()],
                        session_id: Some(id.into()),
                        started_at: saved.started_at,
                        resumed: true,
                    });
                }
            }
            let id = saved_id
                .map(str::to_string)
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            Some(AgentLaunch {
                args: vec!["--session-id".into(), id.clone()],
                session_id: Some(id),
                started_at: Some(now),
                resumed: false,
            })
        }
        SessionKind::Codex => {
            let found = saved_id.map(str::to_string).or_else(|| {
                let (since, h) = (saved.started_at?, home?);
                find_codex_session(h, cwd, since, taken)
            });
            Some(match found {
                Some(id) => AgentLaunch {
                    args: vec!["resume".into(), id.clone()],
                    session_id: Some(id),
                    started_at: saved.started_at,
                    resumed: true,
                },
                None => AgentLaunch {
                    args: vec![],
                    session_id: None,
                    started_at: Some(now),
                    resumed: false,
                },
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn reads_the_session_recorded_by_the_hook() {
        let d = tempfile::tempdir().unwrap();
        let rec = d.path().join("it's.json");
        assert_eq!(recorded_claude_session(&rec), None);
        let settings: Value = serde_json::from_str(&claude_hook_settings(&rec)).unwrap();
        let hook = &settings["hooks"]["SessionStart"][0]["hooks"][0];
        assert_eq!(hook["type"], "command");
        let (shell, cmd) = hook_command(&rec, true);
        assert_eq!(shell, "powershell");
        assert!(cmd.contains("it''s.json'"), "{cmd}");
        let (shell, cmd) = hook_command(&rec, false);
        assert_eq!(shell, "bash");
        assert!(cmd.ends_with(r"it'\''s.json'"), "{cmd}");
        #[cfg(unix)]
        {
            use std::io::Write;
            let mut child = std::process::Command::new("bash")
                .args(["-c", &cmd])
                .stdin(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(br#"{"session_id":"abc-123","source":"clear"}"#)
                .unwrap();
            assert!(child.wait().unwrap().success());
            assert_eq!(recorded_claude_session(&rec).as_deref(), Some("abc-123"));
        }
        fs::write(
            &rec,
            "\u{feff}{\"session_id\":\"7c58cbe5-720a-42f8-adfd-6925e958a400\",\"source\":\"resume\"}\r\n",
        )
        .unwrap();
        assert_eq!(
            recorded_claude_session(&rec).as_deref(),
            Some("7c58cbe5-720a-42f8-adfd-6925e958a400")
        );
        fs::write(&rec, r#"{"session_id":"../../x"}"#).unwrap();
        assert_eq!(recorded_claude_session(&rec), None);
    }

    #[test]
    fn claude_starts_with_id_then_resumes_once_transcript_exists() {
        let d = tempfile::tempdir().unwrap();
        let none = HashSet::new();
        let saved = |id| Saved {
            session_id: id,
            started_at: None,
        };
        let a = plan(
            SessionKind::Claude,
            saved(None),
            Some(d.path()),
            "C:\\p",
            &none,
            1,
        )
        .unwrap();
        let id = a.session_id.clone().unwrap();
        assert_eq!(a.args, vec!["--session-id".to_string(), id.clone()]);
        assert!(!a.resumed);
        let b = plan(
            SessionKind::Claude,
            saved(Some(&id)),
            Some(d.path()),
            "",
            &none,
            2,
        )
        .unwrap();
        assert_eq!(b.args[0], "--session-id");
        fs::create_dir_all(d.path().join("projects/C--p")).unwrap();
        fs::write(d.path().join(format!("projects/C--p/{id}.jsonl")), "{}").unwrap();
        let c = plan(
            SessionKind::Claude,
            saved(Some(&id)),
            Some(d.path()),
            "",
            &none,
            3,
        )
        .unwrap();
        assert_eq!(c.args, vec!["--resume".to_string(), id.clone()]);
        assert!(c.resumed);
        let bad = plan(
            SessionKind::Claude,
            saved(Some("--x; rm")),
            None,
            "",
            &none,
            4,
        )
        .unwrap();
        assert_eq!(bad.args[0], "--session-id");
        assert_ne!(bad.args[1], "--x; rm");
        assert!(plan(SessionKind::Cmd, saved(None), None, "", &none, 1).is_none());
    }

    #[test]
    fn codex_finds_its_rollout_by_cwd_and_time() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("sessions/2026/11/19");
        fs::create_dir_all(&dir).unwrap();
        let meta = |id: &str, ts: &str, cwd: &str| {
            format!(
                r#"{{"timestamp":"{ts}","type":"session_meta","payload":{{"id":"{id}","timestamp":"{ts}","cwd":"{cwd}"}}}}"#
            )
        };
        let start = parse_timestamp("2026-11-19T10:00:00Z").unwrap();
        fs::write(
            dir.join("rollout-a.jsonl"),
            meta("aaaa-1", "2026-11-19T09:00:00Z", "C:\\\\p"),
        )
        .unwrap();
        fs::write(
            dir.join("rollout-b.jsonl"),
            meta("bbbb-2", "2026-11-19T10:00:02Z", "C:\\\\other"),
        )
        .unwrap();
        fs::write(
            dir.join("rollout-c.jsonl"),
            meta("cccc-3", "2026-11-19T10:00:03Z", "c:/P/"),
        )
        .unwrap();
        fs::write(
            dir.join("rollout-d.jsonl"),
            meta("dddd-4", "2026-11-19T10:00:09Z", "C:\\\\p"),
        )
        .unwrap();
        let none = HashSet::new();
        assert_eq!(
            find_codex_session(d.path(), "C:\\p", start, &none).as_deref(),
            Some("cccc-3")
        );
        let taken: HashSet<String> = ["cccc-3".to_string()].into();
        assert_eq!(
            find_codex_session(d.path(), "C:\\p", start, &taken).as_deref(),
            Some("dddd-4")
        );
        let saved = Saved {
            session_id: None,
            started_at: Some(start),
        };
        let p = plan(
            SessionKind::Codex,
            saved,
            Some(d.path()),
            "C:\\p",
            &none,
            start + 1,
        )
        .unwrap();
        assert_eq!(p.args, vec!["resume".to_string(), "cccc-3".to_string()]);
        let fresh = plan(
            SessionKind::Codex,
            Saved {
                session_id: None,
                started_at: None,
            },
            Some(d.path()),
            "C:\\p",
            &none,
            7,
        )
        .unwrap();
        assert!(fresh.args.is_empty() && fresh.started_at == Some(7));
    }
}
