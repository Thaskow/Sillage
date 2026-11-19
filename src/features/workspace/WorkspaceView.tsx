import { useEffect, useMemo } from "react";
import {
  ChevronDown,
  Columns2,
  FolderInput,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Rows2,
  SquareTerminal,
  UserRound,
} from "lucide-react";
import { cx } from "@/lib/cx";
import type { SessionKind } from "@/lib/ipc";
import {
  Button,
  EmptyState,
  IconButton,
  Kbd,
  Tooltip,
} from "@/design-system/primitives";
import { DropdownMenu, type MenuEntry } from "@/design-system/overlays";
import { GroupGlyph } from "@/design-system/group-visuals";
import { useUi } from "@/app/ui-store";
import { useSessions, isAgentKind } from "@/features/sessions/store";
import {
  PanelArea,
  readLayout,
  type Arrangement,
} from "@/features/sessions/PanelArea";
import {
  defaultProfileFor,
  moveAllSessions,
  newSession,
} from "@/features/sessions/actions";
import { useSettings } from "@/features/settings/store";
import { kindIcon } from "@/features/sessions/visuals";
import { ClaudeLogo } from "@/design-system/brand-icons";
import { terminals } from "@/features/sessions/terminal-registry";
import { providerOf, useProfiles } from "@/features/profiles/store";
import { SCRATCH_ID, selectSelectedGroup, useWorkspace } from "./store";

const autoStarted = new Set<string>();

function useKindMenu(agents: boolean): MenuEntry[] {
  const kinds = useSessions((s) => s.kinds);
  const profiles = useProfiles((s) => s.profiles);
  const openAgents = useUi((s) => s.openAgents);
  const groupId = useWorkspace((s) => s.selectedId);
  useSettings((s) => s.settings);
  useWorkspace((s) => s.groups);
  const entries: MenuEntry[] = [];
  for (const k of kinds.filter((x) => x.agent === agents)) {
    const Icon = kindIcon[k.kind];
    const kind = k.kind as SessionKind;
    const accounts = profiles.filter((p) => p.provider === providerOf(k.kind));
    const shortcut =
      k.kind === "claude"
        ? "Ctrl T"
        : k.kind === "powershell"
          ? "Ctrl Maj T"
          : undefined;
    if (!k.path || !accounts.length) {
      entries.push({
        label: k.path ? k.label : `${k.label} (introuvable)`,
        icon: <Icon />,
        disabled: !k.path,
        shortcut,
        onSelect: () => void newSession(kind),
      });
      continue;
    }
    const preferred = defaultProfileFor(kind, groupId);
    const prefix = k.label.split(" ")[0]!.toLowerCase();
    if (entries.length) entries.push("separator");
    for (const p of [null, ...accounts]) {
      entries.push({
        label: !p
          ? `${k.label} · compte habituel`
          : p.name.toLowerCase().startsWith(prefix)
            ? p.name
            : `${k.label} · ${p.name}`,
        icon: (
          <span className="relative flex">
            <Icon size={14} />
            {p && (
              <span
                className="absolute -right-1 -bottom-1 size-2 rounded-full ring-2 ring-raised"
                style={{ background: p.color }}
              />
            )}
          </span>
        ),
        shortcut: (p?.id ?? null) === preferred ? shortcut : undefined,
        onSelect: () => void newSession(kind, p?.id ?? null),
      });
    }
  }
  if (agents) {
    entries.push("separator", {
      label: "Gérer les comptes…",
      icon: <UserRound />,
      onSelect: () => openAgents("settings"),
    });
  }
  return entries;
}

export function WorkspaceView() {
  const group = useWorkspace(selectSelectedGroup);
  const hasGroups = useWorkspace((s) =>
    s.groups.some((g) => g.id !== SCRATCH_ID),
  );
  const allGroups = useWorkspace((s) => s.groups);
  const openGroupDialog = useUi((s) => s.openGroupDialog);
  const updateGroup = useWorkspace((s) => s.updateGroup);
  const defs = useSessions((s) => s.defs);
  const runtime = useSessions((s) => s.runtime);
  const agentMenu = useKindMenu(true);
  const terminalMenu = useKindMenu(false);
  const sessions = useMemo(
    () =>
      defs
        .filter((d) => d.groupId === group?.id)
        .sort((a, b) => a.position - b.position),
    [defs, group?.id],
  );

  useEffect(() => {
    for (const s of sessions) {
      if (
        isAgentKind(s.kind) ||
        autoStarted.has(s.id) ||
        runtime[s.id]?.state !== "stopped"
      )
        continue;
      autoStarted.add(s.id);
      void terminals.start(s.id);
    }
  }, [sessions, runtime]);

  if (!group) {
    return (
      <EmptyState
        icon={<LayoutGrid size={18} />}
        title={hasGroups ? "Sélectionnez un groupe" : "Bienvenue dans Sillage"}
        action={
          !hasGroups && (
            <Button
              variant="primary"
              onClick={() => openGroupDialog({ mode: "create" })}
            >
              <Plus size={14} /> Créer un groupe
            </Button>
          )
        }
      >
        {hasGroups
          ? "Choisissez un groupe dans la barre latérale pour retrouver ses sessions."
          : "Organisez vos agents et vos terminaux en groupes : Travail, projets personnels, serveurs… Tout reste sur cette machine."}
      </EmptyState>
    );
  }

  const layout = readLayout(group);
  const setArrangement = (arrangement: Arrangement) =>
    updateGroup(group.id, { layout: { ...layout, arrangement } });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <GroupGlyph icon={group.icon} color={group.color} size={22} />
        <h1 className="truncate text-[14px] font-semibold tracking-[-0.01em]">
          {group.name}
        </h1>
        {group.archived && (
          <span className="rounded-sm bg-sunken px-1.5 py-px text-[11px] text-fg-3">
            Archivé
          </span>
        )}
        <div className="flex-1" />
        {sessions.length > 1 && (
          <div
            role="radiogroup"
            aria-label="Disposition"
            className="mr-1 flex rounded-md border border-line bg-sunken p-0.5"
          >
            {(
              [
                ["row", "Côte à côte", Columns2],
                ["column", "Empilés", Rows2],
                ["grid", "Grille", LayoutGrid],
              ] as const
            ).map(([value, label, Icon]) => (
              <Tooltip key={value} content={label}>
                <button
                  role="radio"
                  aria-checked={layout.arrangement === value}
                  aria-label={label}
                  onClick={() => setArrangement(value)}
                  className={cx(
                    "transition-quick flex size-[24px] items-center justify-center rounded-[5px]",
                    layout.arrangement === value
                      ? "bg-raised text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
                      : "text-fg-3 hover:text-fg",
                  )}
                >
                  <Icon size={13} />
                </button>
              </Tooltip>
            ))}
          </div>
        )}
        <DropdownMenu align="end" items={terminalMenu}>
          <Button variant="ghost">
            <SquareTerminal size={14} /> Terminal{" "}
            <ChevronDown size={12} className="text-fg-3" />
          </Button>
        </DropdownMenu>
        <DropdownMenu align="end" items={agentMenu}>
          <Button variant="secondary">
            <Plus size={14} /> Agent{" "}
            <ChevronDown size={12} className="text-fg-3" />
          </Button>
        </DropdownMenu>
        {group.id === SCRATCH_ID ? (
          <DropdownMenu
            align="end"
            items={[
              {
                label: "Vers un nouveau groupe…",
                icon: <Plus />,
                onSelect: () =>
                  openGroupDialog({ mode: "create", fromScratch: true }),
              },
              ...allGroups
                .filter((g) => g.id !== SCRATCH_ID && !g.archived)
                .map((g) => ({
                  label: `Vers « ${g.name} »`,
                  icon: <FolderInput />,
                  onSelect: () => void moveAllSessions(SCRATCH_ID, g.id),
                })),
            ]}
          >
            <Button variant="ghost" disabled={!sessions.length}>
              <FolderInput size={14} /> Exporter{" "}
              <ChevronDown size={12} className="text-fg-3" />
            </Button>
          </DropdownMenu>
        ) : (
          <DropdownMenu
            align="end"
            items={[
              {
                label: "Modifier l'apparence…",
                onSelect: () =>
                  openGroupDialog({ mode: "edit", groupId: group.id }),
              },
              {
                label: group.pinned ? "Désépingler" : "Épingler",
                onSelect: () =>
                  updateGroup(group.id, { pinned: !group.pinned }),
              },
            ]}
          >
            <IconButton label="Options du groupe">
              <MoreHorizontal size={15} />
            </IconButton>
          </DropdownMenu>
        )}
      </div>
      <div className="min-h-0 flex-1 bg-bg">
        {sessions.length ? (
          <PanelArea group={group} sessions={sessions} />
        ) : (
          <EmptyState
            icon={<SquareTerminal size={18} />}
            title="Aucune session dans ce groupe"
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => newSession("claude")}>
                  <ClaudeLogo size={14} />
                  <span className="leading-none">Claude Code</span>
                  <span className="ml-1 flex opacity-80">
                    <Kbd>Ctrl T</Kbd>
                  </span>
                </Button>
                <Button onClick={() => newSession("powershell")}>
                  <SquareTerminal size={14} />
                  <span className="leading-none">PowerShell</span>
                  <span className="ml-1 flex">
                    <Kbd>Ctrl Maj T</Kbd>
                  </span>
                </Button>
              </div>
            }
          >
            Lancez un agent et des terminaux côte à côte. Ils continuent de
            tourner quand vous changez de groupe.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
