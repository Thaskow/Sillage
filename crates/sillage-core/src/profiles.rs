use std::path::Path;

use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::sessions::SessionKind;
use crate::workspace::clean_color;
use crate::{now_ms, Error, Result, Store};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Claude,
    Codex,
}

impl Provider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    fn parse(s: &str) -> Self {
        match s {
            "codex" => Self::Codex,
            _ => Self::Claude,
        }
    }

    pub fn env_var(self) -> &'static str {
        match self {
            Self::Claude => "CLAUDE_CONFIG_DIR",
            Self::Codex => "CODEX_HOME",
        }
    }

    pub fn kind(self) -> SessionKind {
        match self {
            Self::Claude => SessionKind::Claude,
            Self::Codex => SessionKind::Codex,
        }
    }

    pub fn of_kind(kind: SessionKind) -> Option<Self> {
        match kind {
            SessionKind::Claude => Some(Self::Claude),
            SessionKind::Codex => Some(Self::Codex),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub color: String,
    pub provider: Provider,
    pub config_dir: String,
    pub share_config: bool,
    pub position: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewProfile {
    pub name: String,
    pub color: String,
    pub provider: Option<Provider>,
    pub config_dir: Option<String>,
    pub share_config: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePatch {
    pub name: Option<String>,
    pub color: Option<String>,
    pub share_config: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub initialized: bool,
    pub signed_in: bool,
    pub email: Option<String>,
    pub organization: Option<String>,
}

pub fn account_status(provider: Provider, dir: &Path) -> AccountStatus {
    if !dir.is_dir() {
        return AccountStatus::default();
    }
    match provider {
        Provider::Claude => {
            let account = std::fs::read_to_string(dir.join(".claude.json"))
                .ok()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                .and_then(|v| v.get("oauthAccount").cloned())
                .filter(|a| a.is_object());
            let field = |k: &str| {
                account
                    .as_ref()
                    .and_then(|a| a.get(k))
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            };
            AccountStatus {
                initialized: true,
                signed_in: account.is_some() || dir.join(".credentials.json").is_file(),
                email: field("emailAddress"),
                organization: field("organizationName"),
            }
        }
        Provider::Codex => AccountStatus {
            initialized: true,
            signed_in: dir.join("auth.json").is_file(),
            email: None,
            organization: None,
        },
    }
}

const COLS: &str = "id, name, color, provider, config_dir, share_config, position, created_at";

fn from_row(r: &Row) -> rusqlite::Result<Profile> {
    let provider: String = r.get(3)?;
    Ok(Profile {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        provider: Provider::parse(&provider),
        config_dir: r.get(4)?,
        share_config: r.get(5)?,
        position: r.get(6)?,
        created_at: r.get(7)?,
    })
}

fn clean_name(name: &str) -> Result<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(Error::Invalid("le nom du compte est obligatoire".into()));
    }
    Ok(n.chars().take(40).collect())
}

impl Store {
    pub fn profiles(&self) -> Result<Vec<Profile>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {COLS} FROM profiles ORDER BY position, created_at"
        ))?;
        let rows = st.query_map([], from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn profile(&self, id: &str) -> Result<Profile> {
        self.conn
            .query_row(
                &format!("SELECT {COLS} FROM profiles WHERE id = ?1"),
                [id],
                from_row,
            )
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("compte {id}")))
    }

    pub fn create_profile(
        &self,
        new: NewProfile,
        default_dir: impl FnOnce(&str) -> String,
    ) -> Result<Profile> {
        let name = clean_name(&new.name)?;
        let id = Uuid::new_v4().to_string();
        let dir = new
            .config_dir
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| default_dir(&id));
        let taken: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM profiles WHERE lower(config_dir) = lower(?1))",
            [&dir],
            |r| r.get(0),
        )?;
        if taken {
            return Err(Error::Invalid(
                "ce dossier est déjà utilisé par un autre compte".into(),
            ));
        }
        let position: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM profiles",
            [],
            |r| r.get(0),
        )?;
        self.conn.execute(
            "INSERT INTO profiles (id, name, color, icon, provider, config_dir, share_config, position, created_at)
             VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                name,
                clean_color(&new.color)?,
                new.provider.unwrap_or(Provider::Claude).as_str(),
                dir,
                new.share_config.unwrap_or(true),
                position,
                now_ms()
            ],
        )?;
        self.profile(&id)
    }

    pub fn update_profile(&self, id: &str, patch: ProfilePatch) -> Result<Profile> {
        let mut p = self.profile(id)?;
        if let Some(n) = patch.name {
            p.name = clean_name(&n)?;
        }
        if let Some(c) = patch.color {
            p.color = clean_color(&c)?;
        }
        if let Some(v) = patch.share_config {
            p.share_config = v;
        }
        self.conn.execute(
            "UPDATE profiles SET name = ?2, color = ?3, share_config = ?4 WHERE id = ?1",
            params![id, p.name, p.color, p.share_config],
        )?;
        Ok(p)
    }

    pub fn delete_profile(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM profiles WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn set_session_profile(&self, session_id: &str, profile_id: Option<&str>) -> Result<()> {
        let session = self.session(session_id)?;
        if let Some(pid) = profile_id {
            let p = self.profile(pid)?;
            if p.provider.kind() != session.kind {
                return Err(Error::Invalid(
                    "ce compte ne correspond pas à ce type de session".into(),
                ));
            }
        }
        self.conn.execute(
            "UPDATE sessions SET profile_id = ?2, agent_session_id = NULL, agent_started_at = NULL WHERE id = ?1",
            params![session_id, profile_id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::NewSession;
    use crate::workspace::NewGroup;

    fn new(name: &str, provider: Provider) -> NewProfile {
        NewProfile {
            name: name.into(),
            color: "#c2410c".into(),
            provider: Some(provider),
            config_dir: None,
            share_config: None,
        }
    }

    #[test]
    fn create_list_update_delete() {
        let s = Store::open_in_memory().unwrap();
        let a = s
            .create_profile(new(" Perso ", Provider::Claude), |id| format!("/p/{id}"))
            .unwrap();
        assert_eq!(a.name, "Perso");
        assert!(a.config_dir.starts_with("/p/"));
        let b = s
            .create_profile(new("Pro", Provider::Codex), |_| "/x".into())
            .unwrap();
        assert_eq!(s.profiles().unwrap().len(), 2);
        assert!(s
            .create_profile(new("Doublon", Provider::Claude), |_| "/X".into())
            .is_err());
        assert!(s
            .create_profile(new("  ", Provider::Claude), |_| "/y".into())
            .is_err());
        let b = s
            .update_profile(
                &b.id,
                ProfilePatch {
                    name: Some("Travail".into()),
                    color: None,
                    share_config: Some(false),
                },
            )
            .unwrap();
        assert_eq!(b.name, "Travail");
        assert!(a.share_config && !b.share_config);
        s.delete_profile(&a.id).unwrap();
        assert_eq!(s.profiles().unwrap().len(), 1);
    }

    #[test]
    fn session_profile_must_match_kind_and_is_cleared_on_delete() {
        let s = Store::open_in_memory().unwrap();
        let g = s
            .create_group(NewGroup {
                name: "G".into(),
                color: "#2c6b63".into(),
                icon: "code".into(),
                ..Default::default()
            })
            .unwrap();
        let p = s
            .create_profile(new("Perso", Provider::Claude), |_| "/a".into())
            .unwrap();
        let ps = s
            .create_session(NewSession {
                group_id: g.id.clone(),
                ..Default::default()
            })
            .unwrap();
        assert!(s.set_session_profile(&ps.id, Some(&p.id)).is_err());
        let c = s
            .create_session(NewSession {
                group_id: g.id,
                kind: Some(SessionKind::Claude),
                ..Default::default()
            })
            .unwrap();
        s.set_session_profile(&c.id, Some(&p.id)).unwrap();
        assert_eq!(s.session(&c.id).unwrap().profile_id, Some(p.id.clone()));
        s.delete_profile(&p.id).unwrap();
        assert_eq!(s.session(&c.id).unwrap().profile_id, None);
    }

    #[test]
    fn reads_account_identity_without_tokens() {
        let d = tempfile::tempdir().unwrap();
        assert!(!account_status(Provider::Claude, &d.path().join("absent")).initialized);
        let st = account_status(Provider::Claude, d.path());
        assert!(st.initialized && !st.signed_in);
        std::fs::write(
            d.path().join(".claude.json"),
            r#"{"oauthAccount":{"emailAddress":"a@b.c","organizationName":"Org"}}"#,
        )
        .unwrap();
        let st = account_status(Provider::Claude, d.path());
        assert!(st.signed_in);
        assert_eq!(st.email.as_deref(), Some("a@b.c"));
        assert_eq!(st.organization.as_deref(), Some("Org"));
        std::fs::write(d.path().join("auth.json"), "{}").unwrap();
        assert!(account_status(Provider::Codex, d.path()).signed_in);
    }
}
