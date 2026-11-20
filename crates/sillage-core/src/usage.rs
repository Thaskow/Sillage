use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

use crate::profiles::Provider;

const HOUR: i64 = 3_600_000;
const WEEK: i64 = 7 * 24 * HOUR;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

impl Tokens {
    fn add(&mut self, o: Tokens) {
        self.input += o.input;
        self.output += o.output;
        self.cache_read += o.cache_read;
        self.cache_write += o.cache_write;
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub tokens: Tokens,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub used_percent: f64,
    pub window_minutes: Option<u64>,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub primary: Option<Window>,
    pub secondary: Option<Window>,
    pub observed_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub last5h: Tokens,
    pub today: Tokens,
    pub week: Tokens,
    pub models: Vec<ModelUsage>,
    pub sessions: u32,
    pub last_activity: Option<i64>,
    pub limits: Option<Limits>,
}

struct Acc {
    now: i64,
    day_start: i64,
    usage: Usage,
    models: BTreeMap<String, Tokens>,
}

impl Acc {
    fn record(&mut self, at: i64, model: &str, t: Tokens) {
        if at < self.now - WEEK {
            return;
        }
        self.usage.week.add(t);
        if at >= self.day_start {
            self.usage.today.add(t);
        }
        if at >= self.now - 5 * HOUR {
            self.usage.last5h.add(t);
        }
        if !model.is_empty() && !model.starts_with('<') {
            self.models.entry(model.to_string()).or_default().add(t);
        }
        self.usage.last_activity = Some(self.usage.last_activity.map_or(at, |l| l.max(at)));
    }
}

pub fn parse_timestamp(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hh, mm, ss) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let mut ms = 0;
    let mut rest = &s[19..];
    if let Some(frac) = rest.strip_prefix('.') {
        let digits: String = frac.chars().take_while(|c| c.is_ascii_digit()).collect();
        ms = format!("{:0<3}", &digits[..digits.len().min(3)])
            .parse()
            .ok()?;
        rest = &frac[digits.len()..];
    }
    let offset = match rest {
        "" | "Z" => 0,
        o if o.len() == 6 => {
            let sign = if o.starts_with('-') { -1 } else { 1 };
            sign * (o.get(1..3)?.parse::<i64>().ok()? * 60 + o.get(4..6)?.parse::<i64>().ok()?)
        }
        _ => return None,
    };
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * ((m + 9) % 12) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400 + hh * 3_600 + mm * 60 + ss - offset * 60) * 1_000) + ms)
}

pub(crate) fn recent_jsonl(root: &Path, since: i64, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for e in entries.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let path = e.path();
        if ft.is_dir() {
            recent_jsonl(&path, since, out);
        } else if ft.is_file() && path.extension().is_some_and(|x| x == "jsonl") {
            let modified = e
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as i64);
            if modified >= since {
                out.push(path);
            }
        }
    }
}

pub(crate) fn lines(path: &Path) -> impl Iterator<Item = String> {
    fs::File::open(path)
        .ok()
        .map(BufReader::new)
        .into_iter()
        .flat_map(|r| {
            r.split(b'\n')
                .map_while(|l| l.ok())
                .map(|l| String::from_utf8_lossy(&l).into_owned())
        })
}

fn n(v: &Value, k: &str) -> u64 {
    v.get(k).and_then(Value::as_u64).unwrap_or(0)
}

#[derive(Debug, Clone, PartialEq)]
struct Entry {
    at: i64,
    model: String,
    tokens: Tokens,
    key: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct Parsed {
    entries: Vec<Entry>,
    limits: Option<Limits>,
}

#[derive(PartialEq)]
struct Stamp {
    modified: SystemTime,
    len: u64,
}

type Cache = HashMap<PathBuf, (Stamp, Arc<Parsed>)>;

static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(Mutex::default);

fn cache() -> MutexGuard<'static, Cache> {
    CACHE.lock().unwrap_or_else(PoisonError::into_inner)
}

fn parsed(files: &[PathBuf], root: &Path, parse: fn(&Path) -> Parsed) -> Vec<Arc<Parsed>> {
    let out = files
        .iter()
        .map(|f| {
            let stamp = fs::metadata(f).ok().and_then(|m| {
                Some(Stamp {
                    modified: m.modified().ok()?,
                    len: m.len(),
                })
            });
            if let Some(hit) = cache()
                .get(f)
                .filter(|(s, _)| stamp.as_ref() == Some(s))
                .map(|(_, p)| p.clone())
            {
                return hit;
            }
            let p = Arc::new(parse(f));
            if let Some(stamp) = stamp {
                cache().insert(f.clone(), (stamp, p.clone()));
            }
            p
        })
        .collect();
    let keep: HashSet<&PathBuf> = files.iter().collect();
    cache().retain(|p, _| !p.starts_with(root) || keep.contains(p));
    out
}

fn parse_claude(path: &Path) -> Parsed {
    let mut out = Parsed::default();
    for line in lines(path) {
        if !line.contains("\"usage\"") || !line.contains("\"assistant\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let msg = &v["message"];
        let usage = &msg["usage"];
        let (Some(at), true) = (
            v["timestamp"].as_str().and_then(parse_timestamp),
            usage.is_object(),
        ) else {
            continue;
        };
        let key = format!(
            "{}:{}",
            msg["id"].as_str().unwrap_or(""),
            v["requestId"].as_str().unwrap_or("")
        );
        out.entries.push(Entry {
            at,
            model: msg["model"].as_str().unwrap_or("").to_string(),
            tokens: Tokens {
                input: n(usage, "input_tokens"),
                output: n(usage, "output_tokens"),
                cache_read: n(usage, "cache_read_input_tokens"),
                cache_write: n(usage, "cache_creation_input_tokens"),
            },
            key: (key != ":").then_some(key),
        });
    }
    out
}

fn claude(dir: &Path, acc: &mut Acc) {
    let root = dir.join("projects");
    let mut files = vec![];
    recent_jsonl(&root, acc.now - WEEK, &mut files);
    let mut seen = HashSet::new();
    for file in parsed(&files, &root, parse_claude) {
        let mut active = false;
        for e in &file.entries {
            if e.key.as_ref().is_some_and(|k| !seen.insert(k.clone())) {
                continue;
            }
            acc.record(e.at, &e.model, e.tokens);
            active |= e.at >= acc.now - WEEK;
        }
        acc.usage.sessions += u32::from(active);
    }
}

fn window(v: &Value, at: i64) -> Option<Window> {
    let used = v.get("used_percent")?.as_f64()?;
    let resets_at = v
        .get("resets_at")
        .and_then(Value::as_i64)
        .map(|s| s * 1000)
        .or_else(|| {
            v.get("resets_in_seconds")
                .and_then(Value::as_i64)
                .map(|s| at + s * 1000)
        });
    Some(Window {
        used_percent: used,
        window_minutes: v.get("window_minutes").and_then(Value::as_u64),
        resets_at,
    })
}

fn parse_codex(path: &Path) -> Parsed {
    let mut out = Parsed::default();
    let mut model = String::new();
    let mut prev = Tokens::default();
    for line in lines(path) {
        let turn = line.contains("\"turn_context\"");
        if !turn && !line.contains("\"token_count\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let p = &v["payload"];
        if turn {
            if let Some(m) = p["model"].as_str() {
                model = m.to_string();
            }
            continue;
        }
        let Some(at) = v["timestamp"].as_str().and_then(parse_timestamp) else {
            continue;
        };
        if let Some(rl) = p.get("rate_limits").filter(|r| r.is_object()) {
            if out.limits.as_ref().is_none_or(|l| l.observed_at <= at) {
                out.limits = Some(Limits {
                    primary: rl.get("primary").and_then(|w| window(w, at)),
                    secondary: rl.get("secondary").and_then(|w| window(w, at)),
                    observed_at: at,
                });
            }
        }
        let total = &p["info"]["total_token_usage"];
        if !total.is_object() {
            continue;
        }
        let cached = n(total, "cached_input_tokens");
        let cur = Tokens {
            input: n(total, "input_tokens").saturating_sub(cached),
            output: n(total, "output_tokens"),
            cache_read: cached,
            cache_write: 0,
        };
        let delta = Tokens {
            input: cur.input.saturating_sub(prev.input),
            output: cur.output.saturating_sub(prev.output),
            cache_read: cur.cache_read.saturating_sub(prev.cache_read),
            cache_write: 0,
        };
        prev = cur;
        if delta != Tokens::default() {
            out.entries.push(Entry {
                at,
                model: model.clone(),
                tokens: delta,
                key: None,
            });
        }
    }
    out
}

fn codex(dir: &Path, acc: &mut Acc) {
    let root = dir.join("sessions");
    let mut files = vec![];
    recent_jsonl(&root, acc.now - WEEK, &mut files);
    for file in parsed(&files, &root, parse_codex) {
        if let Some(l) = &file.limits {
            if acc
                .usage
                .limits
                .as_ref()
                .is_none_or(|cur| cur.observed_at <= l.observed_at)
            {
                acc.usage.limits = Some(l.clone());
            }
        }
        let mut active = false;
        for e in &file.entries {
            acc.record(e.at, &e.model, e.tokens);
            active |= e.at >= acc.now - WEEK;
        }
        acc.usage.sessions += u32::from(active);
    }
}

pub fn usage(provider: Provider, dir: &Path, now: i64, day_start: i64) -> Usage {
    let mut acc = Acc {
        now,
        day_start,
        usage: Usage::default(),
        models: BTreeMap::new(),
    };
    match provider {
        Provider::Claude => claude(dir, &mut acc),
        Provider::Codex => codex(dir, &mut acc),
    }
    let total = |t: &Tokens| t.input + t.output + t.cache_read + t.cache_write;
    let mut models: Vec<ModelUsage> = acc
        .models
        .into_iter()
        .map(|(model, tokens)| ModelUsage { model, tokens })
        .collect();
    models.sort_by_key(|m| std::cmp::Reverse(total(&m.tokens)));
    acc.usage.models = models;
    acc.usage
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_iso_timestamps() {
        assert_eq!(parse_timestamp("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_timestamp("2026-11-19T10:00:00.250Z"),
            Some(1_795_082_400_250)
        );
        assert_eq!(
            parse_timestamp("2026-11-19T11:00:00+01:00"),
            parse_timestamp("2026-11-19T10:00:00Z")
        );
        assert_eq!(parse_timestamp("nope"), None);
    }

    #[test]
    fn sums_claude_transcripts_once_per_message() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("projects/x");
        fs::create_dir_all(&p).unwrap();
        let line = |id: &str, ts: &str| {
            format!(
                r#"{{"type":"assistant","requestId":"r{id}","timestamp":"{ts}","message":{{"id":"{id}","model":"claude-opus-5-5","content":"secret","usage":{{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":1}}}}}}"#
            )
        };
        let body = [
            line("a", "2026-11-19T09:00:00Z"),
            line("a", "2026-11-19T09:00:00Z"),
            line("b", "2026-11-18T09:00:00Z"),
            r#"{"type":"user","message":{"content":"hi"}}"#.into(),
        ]
        .join("\n");
        fs::write(p.join("s.jsonl"), body).unwrap();
        let now = parse_timestamp("2026-11-19T10:00:00Z").unwrap();
        let day = parse_timestamp("2026-11-19T00:00:00Z").unwrap();
        let u = usage(Provider::Claude, d.path(), now, day);
        assert_eq!(u.week.input, 20);
        assert_eq!(u.today.output, 5);
        assert_eq!(u.last5h.cache_read, 100);
        assert_eq!(u.sessions, 1);
        assert_eq!(u.models[0].model, "claude-opus-5-5");
        assert!(u.limits.is_none());
        assert_eq!(usage(Provider::Claude, d.path(), now, day), u);

        let mut more = fs::read(p.join("s.jsonl")).unwrap();
        more.extend_from_slice(b"\n\xff\xfe invalide\n");
        more.extend_from_slice(line("c", "2026-11-19T09:30:00Z").as_bytes());
        fs::write(p.join("s.jsonl"), more).unwrap();
        let u = usage(Provider::Claude, d.path(), now, day);
        assert_eq!(u.week.input, 30);
        assert_eq!(u.today.output, 10);
    }

    #[test]
    fn reads_codex_deltas_and_latest_limits() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("sessions/2026/11/19");
        fs::create_dir_all(&p).unwrap();
        let tc = |ts: &str, input: u64, pct: f64| {
            format!(
                r#"{{"timestamp":"{ts}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":{input},"cached_input_tokens":0,"output_tokens":1}}}},"rate_limits":{{"primary":{{"used_percent":{pct},"window_minutes":300,"resets_in_seconds":60}},"secondary":null}}}}}}"#
            )
        };
        let body = [
            r#"{"timestamp":"2026-11-19T09:00:00Z","type":"turn_context","payload":{"model":"gpt-5-codex"}}"#.to_string(),
            tc("2026-11-19T09:01:00Z", 100, 10.0),
            tc("2026-11-19T09:02:00Z", 100, 10.0),
            tc("2026-11-19T09:03:00Z", 150, 12.5),
        ]
        .join("\n");
        fs::write(p.join("rollout-1.jsonl"), body).unwrap();
        let now = parse_timestamp("2026-11-19T10:00:00Z").unwrap();
        let u = usage(Provider::Codex, d.path(), now, now - 10 * HOUR);
        assert_eq!(u.week.input, 150);
        assert_eq!(u.week.output, 1);
        assert_eq!(u.models[0].model, "gpt-5-codex");
        let l = u.limits.unwrap();
        assert_eq!(l.primary.as_ref().unwrap().used_percent, 12.5);
        assert_eq!(l.primary.unwrap().window_minutes, Some(300));
        assert!(l.secondary.is_none());
    }
}
