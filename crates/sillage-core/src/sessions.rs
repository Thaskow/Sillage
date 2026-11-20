use std::path::{Path, PathBuf};

use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{now_ms, Error, Result, Store};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    Claude,
    Codex,
    Powershell,
    Pwsh,
    Cmd,
    Wsl,
    Custom,
}

impl SessionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Powershell => "powershell",
            Self::Pwsh => "pwsh",
            Self::Cmd => "cmd",
            Self::Wsl => "wsl",
            Self::Custom => "custom",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "claude" => Self::Claude,
            "codex" => Self::Codex,
            "powershell" => Self::Powershell,
            "pwsh" => Self::Pwsh,
            "cmd" => Self::Cmd,
            "wsl" => Self::Wsl,
            "custom" => Self::Custom,
            _ => return None,
        })
    }

    pub fn is_agent(self) -> bool {
        matches!(self, Self::Claude | Self::Codex)
    }

    pub fn default_title(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
            Self::Powershell => "PowerShell",
            Self::Pwsh => "PowerShell 7",
            Self::Cmd if cfg!(windows) => "Invite de commandes",
            Self::Cmd => "Terminal",
            Self::Wsl => "WSL",
            Self::Custom => "Terminal",
        }
    }

    fn candidates(self) -> &'static [&'static str] {
        match self {
            Self::Claude => &["claude.exe", "claude.cmd", "claude"],
            Self::Codex => &["codex.exe", "codex.cmd", "codex"],
            Self::Powershell => &["powershell.exe"],
            Self::Pwsh => &["pwsh.exe", "pwsh"],
            Self::Cmd if cfg!(windows) => &["cmd.exe"],
            Self::Cmd => &["zsh", "bash", "sh"],
            Self::Wsl => &["wsl.exe"],
            Self::Custom => &[],
        }
    }

    pub fn default_args(self) -> Vec<String> {
        match self {
            Self::Powershell | Self::Pwsh => vec!["-NoLogo".into()],
            Self::Cmd if !cfg!(windows) => vec!["-l".into()],
            _ => vec![],
        }
    }

    pub const ALL: [SessionKind; 7] = [
        Self::Claude,
        Self::Codex,
        Self::Powershell,
        Self::Pwsh,
        Self::Cmd,
        Self::Wsl,
        Self::Custom,
    ];
}

pub fn find_program(
    kind: SessionKind,
    path_var: Option<&str>,
    extra_dirs: &[PathBuf],
) -> Option<PathBuf> {
    let dirs: Vec<PathBuf> = path_var
        .map(|p| std::env::split_paths(p).collect())
        .unwrap_or_default();
    for name in kind.candidates() {
        for dir in dirs.iter().chain(extra_dirs) {
            let p = dir.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

const CMD_METACHARS: &[char] = &['&', '|', '<', '>', '^', '%', '!', '"', '\r', '\n'];

pub fn launch_program(program: &Path, args: Vec<String>) -> Result<(PathBuf, Vec<String>)> {
    let is_script = program
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    if !is_script {
        return Ok((program.to_path_buf(), args));
    }
    if let Some(bad) = args.iter().find(|a| a.contains(CMD_METACHARS)) {
        return Err(Error::Invalid(format!(
            "l'argument « {bad} » contient un caractère que cmd.exe interpréterait \
             (& | < > ^ % ! \") : {} est un script .cmd ou .bat",
            program.display()
        )));
    }
    let mut a = vec!["/d".into(), "/c".into(), program.display().to_string()];
    a.extend(args);
    Ok(("cmd.exe".into(), a))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionDef {
    pub id: String,
    pub group_id: String,
    pub kind: SessionKind,
    pub title: String,
    pub profile_id: Option<String>,
    pub cwd: Option<String>,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub persistent: bool,
    pub position: i64,
    pub created_at: i64,
    pub last_active_at: Option<i64>,
    pub agent_session_id: Option<String>,
    pub agent_started_at: Option<i64>,
    pub resume: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewSession {
    pub group_id: String,
    pub kind: Option<SessionKind>,
    pub title: Option<String>,
    pub profile_id: Option<String>,
    pub cwd: Option<String>,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
}

const COLS: &str =
    "id, group_id, kind, title, profile_id, cwd, command, args, persistent, position, created_at, last_active_at, agent_session_id, agent_started_at, resume";

fn from_row(r: &Row) -> rusqlite::Result<SessionDef> {
    let kind: String = r.get(2)?;
    let args: String = r.get(7)?;
    Ok(SessionDef {
        id: r.get(0)?,
        group_id: r.get(1)?,
        kind: SessionKind::parse(&kind).unwrap_or(SessionKind::Custom),
        title: r.get(3)?,
        profile_id: r.get(4)?,
        cwd: r.get(5)?,
        command: r.get(6)?,
        args: serde_json::from_str(&args).unwrap_or_default(),
        persistent: r.get(8)?,
        position: r.get(9)?,
        created_at: r.get(10)?,
        last_active_at: r.get(11)?,
        agent_session_id: r.get(12)?,
        agent_started_at: r.get(13)?,
        resume: r.get(14)?,
    })
}

impl Store {
    pub fn sessions(&self) -> Result<Vec<SessionDef>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {COLS} FROM sessions ORDER BY group_id, position, created_at"
        ))?;
        let rows = st.query_map([], from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn session(&self, id: &str) -> Result<SessionDef> {
        self.conn
            .query_row(
                &format!("SELECT {COLS} FROM sessions WHERE id = ?1"),
                [id],
                from_row,
            )
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("session {id}")))
    }

    pub fn set_agent_session(
        &self,
        id: &str,
        agent_session_id: Option<&str>,
        started_at: Option<i64>,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE sessions SET agent_session_id = ?2, agent_started_at = ?3 WHERE id = ?1",
            params![id, agent_session_id, started_at],
        )?;
        Ok(())
    }

    pub fn set_resume(&self, id: &str, resume: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE sessions SET resume = ?2 WHERE id = ?1",
            params![id, resume],
        )?;
        Ok(())
    }

    pub fn create_session(&self, new: NewSession) -> Result<SessionDef> {
        self.group(&new.group_id)?;
        let kind = new.kind.unwrap_or(SessionKind::Powershell);
        if kind == SessionKind::Custom
            && new
                .command
                .as_deref()
                .map(str::trim)
                .unwrap_or("")
                .is_empty()
        {
            return Err(Error::Invalid(
                "un terminal personnalisé demande une commande".into(),
            ));
        }
        if let Some(pid) = &new.profile_id {
            if self.profile(pid)?.provider.kind() != kind {
                return Err(Error::Invalid(
                    "ce compte ne correspond pas à ce type de session".into(),
                ));
            }
        }
        let title = new
            .title
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| kind.default_title().to_string());
        let id = Uuid::new_v4().to_string();
        let position: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM sessions WHERE group_id = ?1",
            [&new.group_id],
            |r| r.get(0),
        )?;
        self.conn.execute(
            "INSERT INTO sessions (id, group_id, kind, title, profile_id, cwd, command, args, position, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                new.group_id,
                kind.as_str(),
                title.chars().take(80).collect::<String>(),
                new.profile_id,
                new.cwd,
                new.command,
                serde_json::to_string(&new.args)?,
                position,
                now_ms()
            ],
        )?;
        self.session(&id)
    }

    pub fn rename_session(&self, id: &str, title: &str) -> Result<SessionDef> {
        let t = title.trim();
        if t.is_empty() {
            return Err(Error::Invalid("le titre ne peut pas être vide".into()));
        }
        self.conn.execute(
            "UPDATE sessions SET title = ?2 WHERE id = ?1",
            params![id, t.chars().take(80).collect::<String>()],
        )?;
        self.session(id)
    }

    pub fn set_session_cwd(&self, id: &str, cwd: Option<&str>) -> Result<SessionDef> {
        self.session(id)?;
        let cwd = clean_dir(cwd);
        if let Some(dir) = &cwd {
            if !Path::new(dir).is_dir() {
                return Err(Error::Invalid(format!("le dossier {dir} n'existe pas")));
            }
        }
        self.conn.execute(
            "UPDATE sessions SET cwd = ?2, agent_session_id = NULL, agent_started_at = NULL WHERE id = ?1",
            params![id, cwd],
        )?;
        self.session(id)
    }

    pub fn move_session(&self, id: &str, group_id: &str) -> Result<SessionDef> {
        self.group(group_id)?;
        self.conn.execute(
            "UPDATE sessions SET group_id = ?2,
             position = (SELECT COALESCE(MAX(position) + 1, 0) FROM sessions WHERE group_id = ?2)
             WHERE id = ?1",
            params![id, group_id],
        )?;
        self.session(id)
    }

    pub fn touch_session(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE sessions SET last_active_at = ?2 WHERE id = ?1",
            params![id, now_ms()],
        )?;
        Ok(())
    }

    pub fn delete_session(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM sessions WHERE id = ?1", [id])?;
        Ok(())
    }
}

pub fn clean_dir(dir: Option<&str>) -> Option<String> {
    dir.map(|d| d.trim().trim_matches('"').trim().to_string())
        .filter(|d| !d.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::NewGroup;

    fn group(s: &Store, name: &str) -> String {
        s.create_group(NewGroup {
            name: name.into(),
            color: "#2c6b63".into(),
            icon: "code".into(),
            ..Default::default()
        })
        .unwrap()
        .id
    }

    #[test]
    fn create_defaults_and_order() {
        let s = Store::open_in_memory().unwrap();
        let g = group(&s, "Travail");
        let a = s
            .create_session(NewSession {
                group_id: g.clone(),
                kind: Some(SessionKind::Claude),
                ..Default::default()
            })
            .unwrap();
        let b = s
            .create_session(NewSession {
                group_id: g.clone(),
                title: Some(" Build ".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(a.title, "Claude Code");
        assert_eq!(b.kind, SessionKind::Powershell);
        assert_eq!(b.title, "Build");
        assert_eq!((a.position, b.position), (0, 1));
    }

    #[test]
    fn cwd_is_validated_and_resets_the_conversation() {
        let s = Store::open_in_memory().unwrap();
        let g = group(&s, "Dossier");
        let a = s
            .create_session(NewSession {
                group_id: g,
                kind: Some(SessionKind::Claude),
                ..Default::default()
            })
            .unwrap();
        s.set_agent_session(&a.id, Some("conv"), Some(1)).unwrap();
        let dir = std::env::temp_dir().display().to_string();
        let set = s
            .set_session_cwd(&a.id, Some(&format!(" \"{dir}\" ")))
            .unwrap();
        assert_eq!(set.cwd.as_deref(), Some(dir.as_str()));
        assert_eq!(set.agent_session_id, None);
        assert!(s.set_session_cwd(&a.id, Some("/nope/absent")).is_err());
        assert_eq!(s.set_session_cwd(&a.id, Some("  ")).unwrap().cwd, None);
    }

    #[test]
    fn custom_needs_command_and_group_must_exist() {
        let s = Store::open_in_memory().unwrap();
        let g = group(&s, "X");
        assert!(s
            .create_session(NewSession {
                group_id: g,
                kind: Some(SessionKind::Custom),
                ..Default::default()
            })
            .is_err());
        assert!(s
            .create_session(NewSession {
                group_id: "nope".into(),
                ..Default::default()
            })
            .is_err());
    }

    #[test]
    fn move_rename_delete() {
        let s = Store::open_in_memory().unwrap();
        let g1 = group(&s, "A");
        let g2 = group(&s, "B");
        let x = s
            .create_session(NewSession {
                group_id: g1,
                ..Default::default()
            })
            .unwrap();
        let moved = s.move_session(&x.id, &g2).unwrap();
        assert_eq!(moved.group_id, g2);
        assert_eq!(
            s.rename_session(&x.id, "PS build").unwrap().title,
            "PS build"
        );
        assert!(s.rename_session(&x.id, "  ").is_err());
        s.delete_session(&x.id).unwrap();
        assert!(s.sessions().unwrap().is_empty());
    }

    #[test]
    fn finds_program_in_path_then_extra_dirs() {
        let d1 = tempfile::tempdir().unwrap();
        let d2 = tempfile::tempdir().unwrap();
        std::fs::write(d2.path().join("claude.cmd"), "").unwrap();
        let path = std::env::join_paths([d1.path()]).unwrap();
        assert_eq!(find_program(SessionKind::Claude, path.to_str(), &[]), None);
        let found = find_program(
            SessionKind::Claude,
            path.to_str(),
            &[d2.path().to_path_buf()],
        )
        .unwrap();
        assert!(found.ends_with("claude.cmd"));
        let (prog, args) = launch_program(&found, vec!["--resume".into()]).unwrap();
        assert_eq!(prog, PathBuf::from("cmd.exe"));
        assert_eq!(args[0..2], ["/d", "/c"]);
        assert_eq!(args.last().unwrap(), "--resume");
    }

    #[test]
    fn scripts_refuse_arguments_cmd_would_interpret() {
        let script = Path::new("C:/outils/agent.cmd");
        for bad in [
            "a&calc",
            "x|y",
            "%PATH%",
            "say \"hi\"",
            "!v!",
            "a^b",
            "l1\nl2",
        ] {
            assert!(launch_program(script, vec![bad.into()]).is_err(), "{bad}");
        }
        assert!(launch_program(script, vec!["--model".into(), "opus 5".into()]).is_ok());
        let exe = Path::new("C:/outils/agent.exe");
        let (prog, args) = launch_program(exe, vec!["a&b".into()]).unwrap();
        assert_eq!((prog.as_path(), args), (exe, vec!["a&b".to_string()]));
    }
}
