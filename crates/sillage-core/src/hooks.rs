use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

pub const ENV_SESSION: &str = "SILLAGE_SESSION_ID";
pub const ENV_DIR: &str = "SILLAGE_HOOK_DIR";
const EXT: &str = "state";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Activity {
    Working,
    Waiting,
    Done,
}

impl Activity {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "working" => Some(Self::Working),
            "waiting" => Some(Self::Waiting),
            "done" => Some(Self::Done),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Working => "working",
            Self::Waiting => "waiting",
            Self::Done => "done",
        }
    }
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

// Bare file name, resolved through PATH: Claude Code may run hooks in PowerShell, bash or cmd.
pub fn hook_command(exe: &Path, activity: Activity) -> Option<String> {
    let name = exe.file_name()?.to_str()?;
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return None;
    }
    Some(format!("{name} --hook {}", activity.as_str()))
}

pub fn claude_settings(exe: &Path) -> Option<Value> {
    let entry = |a: Activity, matcher: Option<&str>| -> Option<Value> {
        let hook = json!({ "type": "command", "command": hook_command(exe, a)?, "timeout": 5 });
        Some(match matcher {
            Some(m) => json!([{ "matcher": m, "hooks": [hook] }]),
            None => json!([{ "hooks": [hook] }]),
        })
    };
    Some(json!({
        "hooks": {
            "UserPromptSubmit": entry(Activity::Working, None)?,
            "PostToolUse": entry(Activity::Working, Some("*"))?,
            "Notification": entry(Activity::Waiting, Some("permission_prompt|elicitation_dialog"))?,
            "Stop": entry(Activity::Done, None)?,
        }
    }))
}

pub fn merge(into: &mut Value, extra: &Value) {
    let Some(events) = extra["hooks"].as_object() else {
        return;
    };
    if !into["hooks"].is_object() {
        into["hooks"] = json!({});
    }
    for (event, entries) in events {
        let slot = &mut into["hooks"][event];
        if !slot.is_array() {
            *slot = json!([]);
        }
        if let (Some(dst), Some(src)) = (slot.as_array_mut(), entries.as_array()) {
            dst.extend(src.iter().cloned());
        }
    }
}

fn state_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.{EXT}"))
}

pub fn write_state(dir: &Path, id: &str, activity: Activity, at: i64) -> std::io::Result<()> {
    if !valid_id(id) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "identifiant de session invalide",
        ));
    }
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{id}.tmp"));
    fs::write(&tmp, format!("{}\t{at}", activity.as_str()))?;
    fs::rename(tmp, state_path(dir, id))
}

pub fn clear_state(dir: &Path, id: &str) {
    if valid_id(id) {
        let _ = fs::remove_file(state_path(dir, id));
    }
}

pub fn read_states(dir: &Path) -> HashMap<String, (Activity, i64)> {
    let mut out = HashMap::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for e in entries.flatten() {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) != Some(EXT) {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let mut parts = text.trim().splitn(2, '\t');
        let (Some(a), Some(at)) = (parts.next().and_then(Activity::parse), parts.next()) else {
            continue;
        };
        if let Ok(at) = at.parse() {
            out.insert(id.to_string(), (a, at));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_restricted() {
        assert!(valid_id("3f2a-11"));
        assert!(!valid_id("../x"));
        assert!(!valid_id(""));
    }

    #[test]
    fn command_uses_the_bare_exe_name() {
        let exe = Path::new("Program Files")
            .join("Sillage")
            .join("Sillage.exe");
        let c = hook_command(&exe, Activity::Done);
        assert_eq!(c.as_deref(), Some("Sillage.exe --hook done"));
        assert!(hook_command(Path::new(r"C:\x\my app.exe"), Activity::Done).is_none());
    }

    #[test]
    fn settings_cover_the_four_events() {
        let s = claude_settings(Path::new("C:/s.exe")).unwrap();
        for ev in ["UserPromptSubmit", "PostToolUse", "Notification", "Stop"] {
            assert!(s["hooks"][ev][0]["hooks"][0]["command"].is_string(), "{ev}");
        }
        assert_eq!(
            s["hooks"]["Stop"][0]["hooks"][0]["command"],
            "s.exe --hook done"
        );
    }

    #[test]
    fn merge_keeps_existing_hooks() {
        let mut base =
            json!({ "hooks": { "SessionStart": [{ "hooks": [] }], "Stop": [{ "x": 1 }] } });
        merge(&mut base, &claude_settings(Path::new("C:/s.exe")).unwrap());
        assert_eq!(base["hooks"]["SessionStart"].as_array().unwrap().len(), 1);
        assert_eq!(base["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert!(base["hooks"]["UserPromptSubmit"].is_array());
    }

    #[test]
    fn states_round_trip_and_clear() {
        let dir = tempfile::tempdir().unwrap();
        write_state(dir.path(), "abc", Activity::Waiting, 42).unwrap();
        write_state(dir.path(), "abc", Activity::Done, 43).unwrap();
        assert!(write_state(dir.path(), "../x", Activity::Done, 1).is_err());
        let s = read_states(dir.path());
        assert_eq!(s.get("abc"), Some(&(Activity::Done, 43)));
        clear_state(dir.path(), "abc");
        assert!(read_states(dir.path()).is_empty());
    }
}
