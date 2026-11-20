import { locale, t } from "@/lib/i18n";
import type { HistoryEntry } from "./api";

export interface Segment {
  text: string;
  mark: boolean;
}

export function splitSnippet(snippet: string): Segment[] {
  const out: Segment[] = [];
  let mark = false;
  let buf = "";
  const flush = () => {
    if (buf) out.push({ text: buf, mark });
    buf = "";
  };
  for (const ch of snippet) {
    if (ch === "\u0002" || ch === "\u0003") {
      flush();
      mark = ch === "\u0002";
    } else buf += ch === "\n" ? " " : ch;
  }
  flush();
  return out;
}

export function projectName(cwd: string | null): string {
  if (!cwd) return t("Dossier inconnu");
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(ts: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  if (diff === 0) return t("Aujourd'hui");
  if (diff === 1) return t("Hier");
  const d = new Date(ts);
  return d.toLocaleDateString(locale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year:
      d.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  });
}

export function groupByDay<T extends { updatedAt: number }>(
  items: T[],
  now = Date.now(),
): { label: string; items: T[] }[] {
  const out: { key: number; label: string; items: T[] }[] = [];
  for (const it of [...items].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const key = startOfDay(it.updatedAt);
    const last = out[out.length - 1];
    if (last?.key === key) last.items.push(it);
    else out.push({ key, label: dayLabel(it.updatedAt, now), items: [it] });
  }
  return out.map(({ label, items }) => ({ label, items }));
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function resumeCommand(
  e: Pick<HistoryEntry, "tool" | "sessionId" | "cwd">,
  configDir?: string | null,
): string {
  const parts: string[] = [];
  if (e.cwd) parts.push(`Set-Location -LiteralPath ${psQuote(e.cwd)}`);
  if (configDir)
    parts.push(
      `$env:${e.tool === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"} = ${psQuote(configDir)}`,
    );
  parts.push(
    e.tool === "codex"
      ? `codex resume ${e.sessionId}`
      : `claude --resume ${e.sessionId}`,
  );
  return parts.join("; ");
}
