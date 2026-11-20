import { t } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bot } from "lucide-react";
import { cx } from "@/lib/cx";
import { EmptyState, StatusDot, Tooltip } from "@/design-system/primitives";
import { GroupGlyph } from "@/design-system/group-visuals";
import { useUi } from "@/app/ui-store";
import { groupName, useWorkspace } from "@/features/workspace/store";
import {
  isAgentKind,
  useSessions,
  type RunState,
} from "@/features/sessions/store";
import { duration, runtimeStatus } from "@/features/sessions/visuals";
import { useProfiles } from "@/features/profiles/store";
import { AccountAvatar } from "@/features/profiles/ProfileBadge";

type Filter = "all" | "live" | "ended";

const providerLabel: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

export function ActivityView() {
  const defs = useSessions((s) => s.defs);
  const runtime = useSessions((s) => s.runtime);
  const profiles = useProfiles((s) => s.profiles);
  const groups = useWorkspace((s) => s.groups);
  const [filter, setFilter] = useState<Filter>("all");
  const [groupId, setGroupId] = useState<string>("");
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const agents = useMemo(() => {
    const live = (s: RunState | undefined) =>
      s === "running" || s === "starting";
    return defs
      .filter((d) => isAgentKind(d.kind))
      .filter((d) => !groupId || d.groupId === groupId)
      .filter((d) => {
        const st = runtime[d.id]?.state;
        return filter === "all" || (filter === "live" ? live(st) : !live(st));
      })
      .sort(
        (a, b) =>
          Number(live(runtime[b.id]?.state)) -
          Number(live(runtime[a.id]?.state)),
      );
  }, [defs, runtime, filter, groupId]);

  const allAgents = defs.filter((d) => isAgentKind(d.kind));
  if (!allAgents.length) {
    return (
      <EmptyState icon={<Bot size={18} />} title={t("Aucun agent")}>
        {t(
          "Lancez Claude Code depuis un groupe (Ctrl T) : il apparaîtra ici avec son groupe, son état observé et sa durée.",
        )}
      </EmptyState>
    );
  }

  const open = (sessionId: string, gid: string) => {
    useWorkspace.getState().select(gid);
    useSessions.getState().focus(sessionId);
    useUi.getState().setView("workspace");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[920px] px-8 py-8">
        <h1 className="text-[18px] font-semibold tracking-[-0.015em]">
          {t("Activité")}
        </h1>
        <div className="mt-4 flex items-end gap-4">
          <p className="flex-1 text-[var(--fs-sm)] text-fg-3">
            {t(
              "État observé du processus. L'activité détaillée (attente d'une réponse, autorisation) arrivera avec les hooks Claude Code.",
            )}
          </p>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            aria-label={t("Filtrer par groupe")}
            className="h-[var(--row)] rounded-md border border-line-strong bg-raised px-2 text-fg outline-none focus:border-accent"
          >
            <option value="">{t("Tous les groupes")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {groupName(g)}
              </option>
            ))}
          </select>
          <div
            role="radiogroup"
            aria-label={t("État")}
            className="flex rounded-md border border-line bg-sunken p-0.5"
          >
            {(
              [
                ["all", "Tous"],
                ["live", "Actifs"],
                ["ended", "Arrêtés"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                role="radio"
                aria-checked={filter === v}
                onClick={() => setFilter(v)}
                className={cx(
                  "transition-quick h-[calc(var(--row-sm)-2px)] rounded-[5px] px-2.5 text-[var(--fs-sm)]",
                  filter === v
                    ? "bg-raised font-medium text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
                    : "text-fg-2 hover:text-fg",
                )}
              >
                {t(l)}
              </button>
            ))}
          </div>
        </div>

        <ul className="mt-6 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {agents.map((d) => {
            const g = groups.find((x) => x.id === d.groupId);
            const r = runtime[d.id];
            const { status, label } = runtimeStatus(r);
            const account = profiles.find((p) => p.id === d.profileId);
            const live = r?.state === "running" || r?.state === "starting";
            return (
              <li key={d.id}>
                <button
                  onClick={() => g && open(d.id, g.id)}
                  className="group/agent transition-quick flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
                >
                  <Tooltip content={label} side="right">
                    <span className="flex">
                      <StatusDot status={status} />
                    </span>
                  </Tooltip>
                  <AccountAvatar
                    provider={d.kind === "codex" ? "codex" : "claude"}
                    profile={account}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {d.title}
                    </span>
                    <span className="flex items-center gap-1.5 text-[var(--fs-sm)] text-fg-3">
                      {providerLabel[d.kind]} ·{" "}
                      {account ? account.name : t("compte habituel")} · {label}
                    </span>
                  </span>
                  {g && (
                    <span className="flex max-w-48 items-center gap-1.5 text-[var(--fs-sm)] text-fg-2">
                      <GroupGlyph icon={g.icon} color={g.color} size={16} />
                      <span className="truncate">{groupName(g)}</span>
                    </span>
                  )}
                  <span className="w-20 text-right text-[var(--fs-sm)] text-fg-3 tabular-nums">
                    {live
                      ? duration(r?.startedAt)
                      : r?.endedAt
                        ? duration(r.startedAt, r.endedAt)
                        : "—"}
                  </span>
                  <ArrowUpRight
                    size={14}
                    className="text-fg-3 opacity-0 transition-opacity group-hover/agent:opacity-100"
                  />
                </button>
              </li>
            );
          })}
          {!agents.length && (
            <li className="px-4 py-6 text-center text-fg-3">
              {t("Aucun agent pour ce filtre.")}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
