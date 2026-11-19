use std::path::Path;

use serde_json::Value;

use crate::usage::{parse_timestamp, Limits, Window};

pub const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

#[derive(PartialEq, Eq)]
pub enum Token {
    Missing,
    Expired,
    Valid(String),
}

impl std::fmt::Debug for Token {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Missing => "Missing",
            Self::Expired => "Expired",
            Self::Valid(_) => "Valid(…)",
        })
    }
}

pub fn read_token(config_dir: &Path, now: i64) -> Token {
    let Some(oauth) = std::fs::read_to_string(config_dir.join(".credentials.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("claudeAiOauth").cloned())
    else {
        return Token::Missing;
    };
    let Some(token) = oauth
        .get("accessToken")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
    else {
        return Token::Missing;
    };
    match oauth.get("expiresAt").and_then(Value::as_i64) {
        Some(exp) if exp <= now => Token::Expired,
        _ => Token::Valid(token.to_string()),
    }
}

fn window(v: &Value, minutes: u64) -> Option<Window> {
    let used = v.get("utilization")?.as_f64()?;
    Some(Window {
        used_percent: used,
        window_minutes: Some(minutes),
        resets_at: v
            .get("resets_at")
            .and_then(Value::as_str)
            .and_then(parse_timestamp),
    })
}

pub fn parse_limits(v: &Value, now: i64) -> Option<Limits> {
    let primary = v.get("five_hour").and_then(|w| window(w, 300));
    let secondary = v.get("seven_day").and_then(|w| window(w, 10_080));
    if primary.is_none() && secondary.is_none() {
        return None;
    }
    Some(Limits {
        primary,
        secondary,
        observed_at: now,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_token_state_without_exposing_it() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(read_token(d.path(), 0), Token::Missing);
        std::fs::write(
            d.path().join(".credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"sk-secret","expiresAt":1000}}"#,
        )
        .unwrap();
        assert_eq!(read_token(d.path(), 2000), Token::Expired);
        let t = read_token(d.path(), 10);
        assert_eq!(t, Token::Valid("sk-secret".into()));
        assert!(!format!("{t:?}").contains("secret"));
    }

    #[test]
    fn parses_usage_response() {
        let v: Value = serde_json::from_str(
            r#"{"five_hour":{"utilization":37.0,"resets_at":"2026-11-19T15:00:00.123456+00:00"},"seven_day":{"utilization":8,"resets_at":null},"seven_day_opus":null}"#,
        )
        .unwrap();
        let l = parse_limits(&v, 5).unwrap();
        let p = l.primary.unwrap();
        assert_eq!(p.used_percent, 37.0);
        assert_eq!(p.window_minutes, Some(300));
        assert_eq!(p.resets_at, parse_timestamp("2026-11-19T15:00:00.123Z"));
        let s = l.secondary.unwrap();
        assert_eq!(s.used_percent, 8.0);
        assert_eq!(s.resets_at, None);
        assert_eq!(l.observed_at, 5);
        assert!(parse_limits(&serde_json::json!({}), 0).is_none());
    }
}
