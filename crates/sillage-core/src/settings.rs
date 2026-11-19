use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::{Result, Store};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Density {
    Compact,
    #[default]
    Comfortable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Motion {
    #[default]
    System,
    Reduced,
    Full,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub theme: Theme,
    pub density: Density,
    pub motion: Motion,
    pub sidebar_visible: bool,
    pub sidebar_width: u32,
    pub notifications_enabled: bool,
    pub outbound_connections_allowed: bool,
    pub terminal_font_size: u32,
    pub scrollback_lines: u32,
    pub default_claude_profile: Option<String>,
    pub default_codex_profile: Option<String>,
    pub claude_limits_enabled: bool,
    pub auto_update_check: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::System,
            density: Density::Comfortable,
            motion: Motion::System,
            sidebar_visible: true,
            sidebar_width: 264,
            notifications_enabled: true,
            outbound_connections_allowed: false,
            terminal_font_size: 13,
            scrollback_lines: 10_000,
            default_claude_profile: None,
            default_codex_profile: None,
            claude_limits_enabled: true,
            auto_update_check: true,
        }
    }
}

impl Settings {
    fn sanitized(mut self) -> Self {
        self.sidebar_width = self.sidebar_width.clamp(200, 420);
        self.terminal_font_size = self.terminal_font_size.clamp(9, 24);
        self.scrollback_lines = self.scrollback_lines.clamp(1_000, 200_000);
        self
    }
}

const KEY: &str = "app";

impl Store {
    pub fn settings(&self) -> Result<Settings> {
        let raw: Option<String> = self
            .conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [KEY], |r| {
                r.get(0)
            })
            .optional()?;
        Ok(raw
            .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
            .unwrap_or_default()
            .sanitized())
    }

    pub fn save_settings(&self, settings: Settings) -> Result<Settings> {
        let settings = settings.sanitized();
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (KEY, serde_json::to_string(&settings)?),
        )?;
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_private() {
        let s = Store::open_in_memory().unwrap();
        assert!(!s.settings().unwrap().outbound_connections_allowed);
    }

    #[test]
    fn roundtrip_and_clamp() {
        let s = Store::open_in_memory().unwrap();
        let saved = s
            .save_settings(Settings {
                theme: Theme::Dark,
                sidebar_width: 9999,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(saved.sidebar_width, 420);
        assert_eq!(s.settings().unwrap(), saved);
    }

    #[test]
    fn partial_json_keeps_defaults() {
        let s = Store::open_in_memory().unwrap();
        s.conn
            .execute(
                "INSERT INTO settings VALUES ('app', ?1)",
                [r#"{"theme":"light"}"#],
            )
            .unwrap();
        let got = s.settings().unwrap();
        assert_eq!(got.theme, Theme::Light);
        assert_eq!(got.density, Density::Comfortable);
    }
}
