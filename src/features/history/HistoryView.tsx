import { locale, t, translateError } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, History, Play, RefreshCw, Search } from "lucide-react";
import {
  Button,
  EmptyState,
  IconButton,
  Input,
} from "@/design-system/primitives";
import { toast } from "@/design-system/toast";
import { errorMessage } from "@/lib/ipc";
import { useUi } from "@/app/ui-store";
import { useWorkspace } from "@/features/workspace/store";
import { useSessions } from "@/features/sessions/store";
import { terminals } from "@/features/sessions/terminal-registry";
import { useProfiles, providerLabel } from "@/features/profiles/store";
import { AccountAvatar } from "@/features/profiles/ProfileBadge";
import { historyIpc, type HistoryEntry } from "./api";
import { groupByDay, projectName, resumeCommand, splitSnippet } from "./format";

const sameDir = (a: string, b: string) =>
  a.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase() ===
  b.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

function Snippet({ text }: { text: string }) {
  return (
    <span className="mt-1 line-clamp-2 block text-[var(--fs-sm)] text-fg-2">
      {splitSnippet(text).map((s, i) =>
        s.mark ? (
          <mark key={i} className="rounded-[3px] bg-accent/20 px-0.5 text-fg">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

export function HistoryView() {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [indexing, setIndexing] = useState(false);
  const profiles = useProfiles((s) => s.profiles);
  const kinds = useSessions((s) => s.kinds);
  const queryRef = useRef(query);
  queryRef.current = query;

  const load = useCallback(async (q: string) => {
    try {
      const res = await historyIpc.search(q);
      if (queryRef.current === q) setEntries(res);
    } catch (e) {
      toast.error(t("Recherche impossible"), translateError(errorMessage(e)));
      setEntries((prev) => prev ?? []);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      if (await historyIpc.refresh()) setIndexing(true);
      else setIndexing(await historyIpc.indexing());
    } catch {
      setIndexing(false);
    }
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void listen("history-indexed", () => {
      setIndexing(false);
      void load(queryRef.current);
    }).then((u) => (alive ? (off = u) : u()));
    void refresh();
    return () => {
      alive = false;
      off?.();
    };
  }, [load, refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [query, load]);

  const days = useMemo(() => groupByDay(entries ?? []), [entries]);

  const profileFor = (e: HistoryEntry) =>
    profiles.find(
      (p) => p.provider === e.tool && sameDir(p.configDir, e.sourceDir),
    );

  const copy = async (e: HistoryEntry) => {
    try {
      await writeText(resumeCommand(e, profileFor(e)?.configDir));
      toast.info(
        t("Commande copiée"),
        t("Collez-la dans un terminal PowerShell."),
      );
    } catch (err) {
      toast.error(t("Copie impossible"), translateError(errorMessage(err)));
    }
  };

  const resume = async (e: HistoryEntry) => {
    const groupId = useWorkspace.getState().selectedId;
    const info = kinds.find((k) => k.kind === e.tool);
    if (!groupId || (info && !info.path)) {
      await copy(e);
      if (!groupId)
        toast.info(t("Choisissez d'abord un groupe pour reprendre"));
      return;
    }
    try {
      const def = await historyIpc.resume(e.id, groupId);
      useSessions.setState((s) => ({ defs: [...s.defs, def] }));
      useUi.getState().setView("workspace");
      useSessions.getState().focus(def.id);
      void terminals.start(def.id);
    } catch (err) {
      toast.error(t("Reprise impossible"), translateError(errorMessage(err)));
    }
  };

  if (entries && !entries.length && !query && !indexing) {
    return (
      <EmptyState
        icon={<History size={18} />}
        title={t("Historique vide")}
        action={
          <Button onClick={() => void refresh()}>
            <RefreshCw size={14} /> {t("Réindexer")}
          </Button>
        }
      >
        {t(
          "Aucune conversation Claude Code ou Codex trouvée sur ce poste. Les transcripts sont lus localement, sans copie vers l'extérieur.",
        )}
      </EmptyState>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[920px] px-8 py-8">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-[18px] font-semibold tracking-[-0.015em]">
            {t("Historique")}
          </h1>
          <span
            role="status"
            className="text-[var(--fs-sm)] text-fg-3"
            aria-live="polite"
          >
            {indexing ? t("Indexation…") : ""}
          </span>
          <IconButton
            label={t("Réindexer les conversations")}
            onClick={() => void refresh()}
            disabled={indexing}
          >
            <RefreshCw size={14} className={indexing ? "animate-spin" : ""} />
          </IconButton>
        </div>
        <div className="relative mt-4">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-3"
          />
          <Input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && query && setQuery("")}
            placeholder={t("Rechercher dans les conversations")}
            aria-label={t("Rechercher dans les conversations")}
            className="pl-8"
          />
        </div>

        {entries && !entries.length && (
          <p className="mt-8 text-center text-fg-3">
            {query
              ? t("Aucune conversation ne correspond.")
              : t("Indexation en cours…")}
          </p>
        )}

        {days.map((day) => (
          <section key={day.label} className="mt-6">
            <h2 className="mb-2 text-[var(--fs-sm)] font-medium text-fg-3 first-letter:uppercase">
              {day.label}
            </h2>
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {day.items.map((e) => {
                const profile = profileFor(e);
                return (
                  <li
                    key={e.id}
                    className="group/h flex items-start gap-3 px-4 py-3"
                  >
                    <AccountAvatar provider={e.tool} profile={profile} />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {e.title}
                      </span>
                      <span className="flex items-center gap-1.5 text-[var(--fs-sm)] text-fg-3">
                        <span title={e.cwd ?? undefined} className="truncate">
                          {projectName(e.cwd)}
                        </span>
                        · {providerLabel[e.tool]}
                        {profile ? ` · ${profile.name}` : ""} ·{" "}
                        {new Date(e.updatedAt).toLocaleTimeString(locale(), {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {e.snippet && <Snippet text={e.snippet} />}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-60 group-focus-within/h:opacity-100 group-hover/h:opacity-100">
                      <IconButton
                        label={t("Copier la commande de reprise")}
                        onClick={() => void copy(e)}
                      >
                        <Copy size={14} />
                      </IconButton>
                      <Button
                        variant="ghost"
                        aria-label={t("Reprendre « {title} »", {
                          title: e.title,
                        })}
                        onClick={() => void resume(e)}
                      >
                        <Play size={14} /> {t("Reprendre")}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
