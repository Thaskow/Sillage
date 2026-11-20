import { invoke } from "@tauri-apps/api/core";
import type { Provider, SessionDef } from "@/lib/ipc";

export interface HistoryEntry {
  id: number;
  tool: Provider;
  sourceDir: string;
  sessionId: string;
  cwd: string | null;
  title: string;
  startedAt: number | null;
  updatedAt: number;
  messages: number;
  snippet: string | null;
}

export interface IndexStats {
  files: number;
  updated: number;
  removed: number;
}

export const historyIpc = {
  search: (query: string, limit?: number) =>
    invoke<HistoryEntry[]>("history_search", { query, limit }),
  refresh: () => invoke<boolean>("history_refresh"),
  indexing: () => invoke<boolean>("history_indexing"),
  resume: (id: number, groupId: string) =>
    invoke<SessionDef>("history_resume", { id, groupId }),
};
