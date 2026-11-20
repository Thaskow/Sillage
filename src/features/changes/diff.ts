import type { ChangeKind } from "./ipc";

export type LineKind = "add" | "del" | "ctx" | "hunk" | "meta";

export interface DiffLine {
  kind: LineKind;
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface ParsedDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
}

const hunkRe = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseDiff(text: string): ParsedDiff {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let header = true;
  let oldNo = 0;
  let newNo = 0;
  const raw = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!raw) return { lines, added, removed };
  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      header = true;
      lines.push({ kind: "meta", text: line });
      continue;
    }
    const h = hunkRe.exec(line);
    if (h) {
      header = false;
      oldNo = Number(h[1]);
      newNo = Number(h[2]);
      lines.push({ kind: "hunk", text: line });
      continue;
    }
    if (header || line.startsWith("\\")) {
      lines.push({ kind: "meta", text: line });
    } else if (line.startsWith("+")) {
      added++;
      lines.push({ kind: "add", text: line.slice(1), newNo: newNo++ });
    } else if (line.startsWith("-")) {
      removed++;
      lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++ });
    } else {
      lines.push({
        kind: "ctx",
        text: line.slice(1),
        oldNo: oldNo++,
        newNo: newNo++,
      });
    }
  }
  return { lines, added, removed };
}

export const kindInfo: Record<ChangeKind, { letter: string; label: string }> = {
  modified: { letter: "M", label: "Modifié" },
  added: { letter: "A", label: "Ajouté" },
  deleted: { letter: "D", label: "Supprimé" },
  renamed: { letter: "R", label: "Renommé" },
  copied: { letter: "C", label: "Copié" },
  typeChanged: { letter: "T", label: "Type modifié" },
  untracked: { letter: "U", label: "Non suivi" },
  conflicted: { letter: "!", label: "En conflit" },
};

export function splitPath(path: string): { dir: string; name: string } {
  const i = path.replace(/\/$/, "").lastIndexOf("/");
  return i < 0
    ? { dir: "", name: path }
    : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}
