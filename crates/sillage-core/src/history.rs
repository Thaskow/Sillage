use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use serde_json::Value;

use crate::profiles::Provider;
use crate::usage::{lines, parse_timestamp, recent_jsonl};
use crate::{Error, Result, Store};

const MSG_CAP: usize = 4_000;
const BODY_CAP: usize = 200_000;
const TITLE_CAP: usize = 140;
pub const MARK_START: char = '\u{2}';
pub const MARK_END: char = '\u{3}';

#[derive(Debug, Clone)]
pub struct Root {
    pub provider: Provider,
    pub dir: PathBuf,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Parsed {
    pub session_id: String,
    pub cwd: Option<String>,
    pub title: String,
    pub started_at: Option<i64>,
    pub updated_at: Option<i64>,
    pub messages: usize,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub tool: Provider,
    pub source_dir: String,
    pub session_id: String,
    pub cwd: Option<String>,
    pub title: String,
    pub started_at: Option<i64>,
    pub updated_at: i64,
    pub messages: i64,
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub files: usize,
    pub updated: usize,
    pub removed: usize,
}

fn cap(s: &str, max: usize) -> &str {
    match s.char_indices().nth(max) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

fn one_line(s: &str) -> String {
    cap(
        &s.split_whitespace().collect::<Vec<_>>().join(" "),
        TITLE_CAP,
    )
    .to_string()
}

fn is_noise(text: &str) -> bool {
    let t = text.trim_start();
    t.is_empty()
        || t.starts_with('<')
        || t.starts_with("[Request interrupted")
        || t.starts_with("Caveat: ")
        || t.starts_with("# AGENTS.md instructions")
}

#[derive(Default)]
struct Builder {
    p: Parsed,
    first_user: Option<String>,
}

impl Builder {
    fn time(&mut self, v: &Value) {
        if let Some(at) = v["timestamp"].as_str().and_then(parse_timestamp) {
            self.p.started_at = Some(self.p.started_at.map_or(at, |s| s.min(at)));
            self.p.updated_at = Some(self.p.updated_at.map_or(at, |s| s.max(at)));
        }
    }

    fn push(&mut self, user: bool, text: &str) {
        if user && is_noise(text) {
            return;
        }
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        if user && self.first_user.is_none() {
            self.first_user = Some(one_line(text));
        }
        self.p.messages += 1;
        if self.p.body.len() < BODY_CAP {
            if !self.p.body.is_empty() {
                self.p.body.push('\n');
            }
            self.p.body.push_str(cap(text, MSG_CAP));
        }
    }

    fn finish(mut self, fallback_id: &str, title: Option<String>) -> Parsed {
        if self.p.session_id.is_empty() {
            self.p.session_id = fallback_id.to_string();
        }
        self.p.title = title
            .filter(|t| !t.is_empty())
            .or(self.first_user)
            .unwrap_or_else(|| "Conversation sans message".into());
        self.p
    }
}

fn blocks(content: &Value, kinds: &[&str]) -> Vec<String> {
    match content {
        Value::String(s) => vec![s.clone()],
        Value::Array(items) => items
            .iter()
            .filter(|b| b["type"].as_str().is_some_and(|t| kinds.contains(&t)))
            .filter_map(|b| b["text"].as_str().map(str::to_string))
            .collect(),
        _ => vec![],
    }
}

fn stem(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub fn parse_claude(path: &Path) -> Option<Parsed> {
    fs::metadata(path).ok()?;
    let mut b = Builder::default();
    let mut ai_title = None;
    for line in lines(path) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if b.p.session_id.is_empty() {
            if let Some(id) = v["sessionId"].as_str() {
                b.p.session_id = id.to_string();
            }
        }
        if b.p.cwd.is_none() {
            b.p.cwd = v["cwd"].as_str().map(str::to_string);
        }
        let kind = v["type"].as_str().unwrap_or("");
        if kind == "ai-title" {
            ai_title = v["aiTitle"].as_str().map(one_line);
            continue;
        }
        if !matches!(kind, "user" | "assistant")
            || v["isMeta"].as_bool() == Some(true)
            || v["isSidechain"].as_bool() == Some(true)
        {
            continue;
        }
        b.time(&v);
        for text in blocks(&v["message"]["content"], &["text"]) {
            b.push(kind == "user", &text);
        }
    }
    Some(b.finish(&stem(path), ai_title))
}

pub fn parse_codex(path: &Path) -> Option<Parsed> {
    fs::metadata(path).ok()?;
    let mut b = Builder::default();
    let mut items: Vec<(bool, String)> = vec![];
    let mut has_events = false;
    for line in lines(path) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let p = &v["payload"];
        match (v["type"].as_str(), p["type"].as_str()) {
            (Some("session_meta"), _) => {
                if let Some(id) = p["id"].as_str() {
                    b.p.session_id = id.to_string();
                }
                b.p.cwd = p["cwd"].as_str().map(str::to_string);
            }
            (Some("event_msg"), Some(t @ ("user_message" | "agent_message"))) => {
                has_events = true;
                b.time(&v);
                if let Some(m) = p["message"].as_str() {
                    b.push(t == "user_message", m);
                }
            }
            (Some("response_item"), Some("message")) if !has_events => {
                let user = p["role"] == "user";
                if user || p["role"] == "assistant" {
                    b.time(&v);
                    for text in blocks(&p["content"], &["input_text", "output_text"]) {
                        items.push((user, text));
                    }
                }
            }
            _ => {}
        }
    }
    if !has_events {
        for (user, text) in items {
            b.push(user, &text);
        }
    }
    Some(b.finish(&stem(path), None))
}

fn transcripts(root: &Root) -> Vec<PathBuf> {
    let mut out = vec![];
    match root.provider {
        Provider::Claude => {
            let Ok(projects) = fs::read_dir(root.dir.join("projects")) else {
                return out;
            };
            for p in projects.flatten().filter(|e| e.path().is_dir()) {
                let Ok(files) = fs::read_dir(p.path()) else {
                    continue;
                };
                out.extend(
                    files
                        .flatten()
                        .map(|f| f.path())
                        .filter(|f| f.is_file() && f.extension().is_some_and(|x| x == "jsonl")),
                );
            }
        }
        Provider::Codex => {
            recent_jsonl(&root.dir.join("sessions"), 0, &mut out);
            out.retain(|f| {
                f.file_name()
                    .is_some_and(|n| n.to_string_lossy().starts_with("rollout-"))
            });
        }
    }
    out
}

fn stat(path: &Path) -> Option<(i64, i64)> {
    let m = fs::metadata(path).ok()?;
    let mtime = m
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis() as i64;
    Some((m.len() as i64, mtime))
}

pub fn fts_query(q: &str) -> Option<String> {
    let terms: Vec<String> = q
        .split_whitespace()
        .map(|t| t.replace('"', ""))
        .filter(|t| t.chars().any(char::is_alphanumeric))
        .map(|t| format!("\"{t}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

const ENTRY_COLS: &str = "c.id, c.tool, c.source_dir, c.session_id, c.cwd, c.title, c.started_at, c.updated_at, c.messages";

fn entry(r: &Row, snippet: bool) -> rusqlite::Result<HistoryEntry> {
    let tool: String = r.get(1)?;
    Ok(HistoryEntry {
        id: r.get(0)?,
        tool: if tool == "codex" {
            Provider::Codex
        } else {
            Provider::Claude
        },
        source_dir: r.get(2)?,
        session_id: r.get(3)?,
        cwd: r.get(4)?,
        title: r.get(5)?,
        started_at: r.get(6)?,
        updated_at: r.get(7)?,
        messages: r.get(8)?,
        snippet: if snippet { r.get(9)? } else { None },
    })
}

impl Store {
    pub fn open_secondary(path: &Path) -> Result<Store> {
        let conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(Store { conn })
    }

    pub fn index_history(&mut self, roots: &[Root]) -> Result<IndexStats> {
        let mut known: HashMap<String, (i64, i64, i64)> = HashMap::new();
        {
            let mut st = self
                .conn
                .prepare("SELECT path, id, size, mtime FROM history_conversations")?;
            let rows = st.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?)))
            })?;
            for row in rows {
                let (path, v) = row?;
                known.insert(path, v);
            }
        }
        let mut stats = IndexStats::default();
        let mut seen: HashSet<String> = HashSet::new();
        for root in roots {
            for file in transcripts(root) {
                let key = file.display().to_string();
                if !seen.insert(key.clone()) {
                    continue;
                }
                stats.files += 1;
                let Some((size, mtime)) = stat(&file) else {
                    continue;
                };
                let existing = known.get(&key).copied();
                if existing.is_some_and(|(_, s, m)| s == size && m == mtime) {
                    continue;
                }
                let parsed = match root.provider {
                    Provider::Claude => parse_claude(&file),
                    Provider::Codex => parse_codex(&file),
                };
                let Some(p) = parsed else { continue };
                self.write_conversation(existing.map(|e| e.0), &key, size, mtime, root, &p)?;
                stats.updated += 1;
            }
        }
        let gone: Vec<i64> = known
            .iter()
            .filter(|(path, _)| !seen.contains(*path))
            .map(|(_, v)| v.0)
            .collect();
        if !gone.is_empty() {
            let tx = self.conn.transaction()?;
            for id in &gone {
                tx.execute("DELETE FROM history_conversations WHERE id = ?1", [id])?;
                tx.execute("DELETE FROM history_fts WHERE rowid = ?1", [id])?;
            }
            tx.commit()?;
        }
        stats.removed = gone.len();
        Ok(stats)
    }

    fn write_conversation(
        &mut self,
        existing: Option<i64>,
        path: &str,
        size: i64,
        mtime: i64,
        root: &Root,
        p: &Parsed,
    ) -> Result<()> {
        let tx = self.conn.transaction()?;
        let updated_at = p.updated_at.unwrap_or(mtime);
        let source = root.dir.display().to_string();
        let id = match existing {
            Some(id) => {
                tx.execute(
                    "UPDATE history_conversations SET size=?2, mtime=?3, tool=?4, source_dir=?5, session_id=?6, cwd=?7, title=?8, started_at=?9, updated_at=?10, messages=?11 WHERE id=?1",
                    params![id, size, mtime, root.provider.as_str(), source, p.session_id, p.cwd, p.title, p.started_at, updated_at, p.messages as i64],
                )?;
                tx.execute("DELETE FROM history_fts WHERE rowid = ?1", [id])?;
                id
            }
            None => {
                tx.execute(
                    "INSERT INTO history_conversations (path, size, mtime, tool, source_dir, session_id, cwd, title, started_at, updated_at, messages) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![path, size, mtime, root.provider.as_str(), source, p.session_id, p.cwd, p.title, p.started_at, updated_at, p.messages as i64],
                )?;
                tx.last_insert_rowid()
            }
        };
        if p.messages > 0 {
            tx.execute(
                "INSERT INTO history_fts (rowid, title, body) VALUES (?1, ?2, ?3)",
                params![id, p.title, p.body],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn history(&self, query: &str, limit: usize) -> Result<Vec<HistoryEntry>> {
        let limit = limit.clamp(1, 1_000) as i64;
        let rows = match fts_query(query) {
            Some(q) => {
                let sql = format!(
                    "SELECT {ENTRY_COLS}, snippet(history_fts, 1, char(2), char(3), '…', 14) FROM history_fts JOIN history_conversations c ON c.id = history_fts.rowid WHERE history_fts MATCH ?1 AND c.messages > 0 ORDER BY bm25(history_fts, 4.0, 1.0) LIMIT ?2"
                );
                let mut st = self.conn.prepare(&sql)?;
                let it = st.query_map(params![q, limit], |r| entry(r, true))?;
                it.collect::<rusqlite::Result<Vec<_>>>()?
            }
            None => {
                let sql = format!(
                    "SELECT {ENTRY_COLS} FROM history_conversations c WHERE c.messages > 0 ORDER BY c.updated_at DESC LIMIT ?1"
                );
                let mut st = self.conn.prepare(&sql)?;
                let it = st.query_map([limit], |r| entry(r, false))?;
                it.collect::<rusqlite::Result<Vec<_>>>()?
            }
        };
        Ok(rows)
    }

    pub fn history_entry(&self, id: i64) -> Result<HistoryEntry> {
        self.conn
            .query_row(
                &format!("SELECT {ENTRY_COLS} FROM history_conversations c WHERE c.id = ?1"),
                [id],
                |r| entry(r, false),
            )
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("conversation {id}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, lines: &[Value]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let body: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
        fs::write(path, body.join("\n")).unwrap();
    }

    fn claude_lines(id: &str, prompt: &str, answer: &str) -> Vec<Value> {
        vec![
            serde_json::json!({"type":"user","sessionId":id,"cwd":"C:\\dev\\app","isMeta":true,"timestamp":"2026-01-01T09:59:00Z","message":{"role":"user","content":"<local-command-caveat>x</local-command-caveat>"}}),
            serde_json::json!({"type":"user","sessionId":id,"cwd":"C:\\dev\\app","timestamp":"2026-01-01T10:00:00Z","message":{"role":"user","content":"<command-name>/clear</command-name>"}}),
            serde_json::json!({"type":"user","sessionId":id,"cwd":"C:\\dev\\app","timestamp":"2026-01-01T10:00:01Z","message":{"role":"user","content":prompt}}),
            serde_json::json!({"type":"assistant","sessionId":id,"timestamp":"2026-01-01T10:00:05Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"secret pensée"},{"type":"text","text":answer},{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}),
            serde_json::json!({"type":"user","sessionId":id,"timestamp":"2026-01-01T10:00:06Z","message":{"role":"user","content":[{"type":"tool_result","content":"énorme sortie outil"}]}}),
            serde_json::json!({"type":"assistant","sessionId":id,"isSidechain":true,"timestamp":"2026-01-01T10:00:07Z","message":{"content":[{"type":"text","text":"sous-agent"}]}}),
        ]
    }

    #[test]
    fn claude_keeps_only_user_and_assistant_text() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.jsonl");
        write(
            &f,
            &claude_lines("abc-1", "Corrige   le\nbug de connexion", "C'est réglé."),
        );
        let p = parse_claude(&f).unwrap();
        assert_eq!(p.session_id, "abc-1");
        assert_eq!(p.cwd.as_deref(), Some("C:\\dev\\app"));
        assert_eq!(p.title, "Corrige le bug de connexion");
        assert_eq!(p.messages, 2);
        assert!(p.body.contains("C'est réglé."));
        for hidden in ["pensée", "énorme", "sous-agent", "/clear", "caveat"] {
            assert!(!p.body.contains(hidden), "{hidden}");
        }
        assert_eq!(p.started_at, parse_timestamp("2026-01-01T10:00:00Z"));
        assert_eq!(p.updated_at, parse_timestamp("2026-01-01T10:00:06Z"));
    }

    #[test]
    fn claude_prefers_ai_title() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.jsonl");
        let mut l = claude_lines("abc", "question", "réponse");
        l.push(serde_json::json!({"type":"ai-title","aiTitle":"Titre court","sessionId":"abc"}));
        write(&f, &l);
        assert_eq!(parse_claude(&f).unwrap().title, "Titre court");
    }

    #[test]
    fn codex_prefers_events_and_skips_context() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("rollout-x.jsonl");
        write(
            &f,
            &[
                serde_json::json!({"type":"session_meta","timestamp":"2026-01-02T08:00:00Z","payload":{"id":"0199-aa","cwd":"D:\\proj"}}),
                serde_json::json!({"type":"response_item","timestamp":"2026-01-02T08:00:01Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>x</environment_context>"}]}}),
                serde_json::json!({"type":"response_item","timestamp":"2026-01-02T08:00:01Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Ajoute des tests"}]}}),
                serde_json::json!({"type":"event_msg","timestamp":"2026-01-02T08:00:01Z","payload":{"type":"user_message","message":"Ajoute des tests"}}),
                serde_json::json!({"type":"response_item","timestamp":"2026-01-02T08:00:02Z","payload":{"type":"function_call_output","output":"sortie"}}),
                serde_json::json!({"type":"event_msg","timestamp":"2026-01-02T08:00:03Z","payload":{"type":"agent_message","message":"Tests ajoutés"}}),
            ],
        );
        let p = parse_codex(&f).unwrap();
        assert_eq!(p.session_id, "0199-aa");
        assert_eq!(p.cwd.as_deref(), Some("D:\\proj"));
        assert_eq!(p.title, "Ajoute des tests");
        assert_eq!(p.messages, 2);
        assert_eq!(p.body, "Ajoute des tests\nTests ajoutés");
    }

    #[test]
    fn codex_falls_back_to_response_items() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("rollout-y.jsonl");
        write(
            &f,
            &[
                serde_json::json!({"type":"session_meta","payload":{"id":"0199-bb","cwd":"D:\\p"}}),
                serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Bonjour"}]}}),
                serde_json::json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Salut"}]}}),
            ],
        );
        let p = parse_codex(&f).unwrap();
        assert_eq!((p.messages, p.body.as_str()), (2, "Bonjour\nSalut"));
    }

    #[test]
    fn fts_query_quotes_terms_as_prefixes() {
        assert_eq!(fts_query("  "), None);
        assert_eq!(fts_query("- ()"), None);
        assert_eq!(
            fts_query("conn\"exion OR bug"),
            Some("\"connexion\"* \"OR\"* \"bug\"*".into())
        );
    }

    #[test]
    fn indexes_incrementally_and_searches() {
        let tmp = tempfile::tempdir().unwrap();
        let claude = tmp.path().join("claude");
        let codex = tmp.path().join("codex");
        let a = claude.join("projects").join("C--dev-app").join("aaa.jsonl");
        write(
            &a,
            &claude_lines("aaa", "Problème de connexion OAuth", "Jeton expiré."),
        );
        let b = codex
            .join("sessions")
            .join("2026")
            .join("01")
            .join("rollout-2026-b.jsonl");
        write(
            &b,
            &[
                serde_json::json!({"type":"session_meta","payload":{"id":"0199-cc","cwd":"D:\\p"}}),
                serde_json::json!({"type":"event_msg","timestamp":"2026-03-01T00:00:00Z","payload":{"type":"user_message","message":"Refactor du parseur"}}),
            ],
        );
        fs::write(codex.join("sessions").join("other.jsonl"), "{}").unwrap();
        let roots = vec![
            Root {
                provider: Provider::Claude,
                dir: claude.clone(),
            },
            Root {
                provider: Provider::Codex,
                dir: codex.clone(),
            },
            Root {
                provider: Provider::Claude,
                dir: claude.clone(),
            },
        ];
        let mut s = Store::open_in_memory().unwrap();
        let st = s.index_history(&roots).unwrap();
        assert_eq!((st.files, st.updated, st.removed), (2, 2, 0));
        assert_eq!(s.index_history(&roots).unwrap().updated, 0);

        let all = s.history("", 50).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].tool, Provider::Codex);
        assert_eq!(all[1].session_id, "aaa");
        assert_eq!(all[1].source_dir, claude.display().to_string());

        let hits = s.history("connex", 50).unwrap();
        assert_eq!(hits.len(), 1);
        let snip = hits[0].snippet.as_deref().unwrap();
        assert!(
            snip.contains(&format!("{MARK_START}connexion{MARK_END}")),
            "{snip}"
        );
        assert_eq!(s.history("expire", 50).unwrap().len(), 1);
        assert!(s.history("introuvable", 50).unwrap().is_empty());

        write(&a, &claude_lines("aaa", "Autre sujet totalement", "Rien"));
        let st = s.index_history(&roots).unwrap();
        assert_eq!(st.updated, 1);
        assert!(s.history("connexion", 50).unwrap().is_empty());
        assert_eq!(s.history("totalement", 50).unwrap().len(), 1);
        let id = s.history("totalement", 50).unwrap()[0].id;
        assert_eq!(s.history_entry(id).unwrap().title, "Autre sujet totalement");

        fs::remove_file(&b).unwrap();
        let st = s.index_history(&roots).unwrap();
        assert_eq!(st.removed, 1);
        assert_eq!(s.history("", 50).unwrap().len(), 1);
        assert!(s.history("parseur", 50).unwrap().is_empty());
    }

    #[test]
    fn secondary_connection_sees_main_schema() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("sillage.db");
        let (main, _) = Store::open(&path).unwrap();
        let mut side = Store::open_secondary(&path).unwrap();
        assert_eq!(side.index_history(&[]).unwrap(), IndexStats::default());
        assert!(main.history("", 10).unwrap().is_empty());
    }
}
