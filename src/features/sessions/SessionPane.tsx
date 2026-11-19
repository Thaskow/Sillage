import { useEffect, useRef, useState } from "react";
import {
  UserRound,
  ChevronDown,
  Loader2,
  ChevronUp,
  FolderInput,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Pencil,
  Play,
  RotateCw,
  Search,
  Square,
  X,
} from "lucide-react";
import { cx } from "@/lib/cx";
import type { SessionDef } from "@/lib/ipc";
import {
  Button,
  IconButton,
  StatusDot,
  Tooltip,
} from "@/design-system/primitives";
import { ContextMenu, type MenuEntry } from "@/design-system/overlays";
import { useWorkspace } from "@/features/workspace/store";
import { useSessions } from "./store";
import { terminals } from "./terminal-registry";
import { closeSession, stopSession } from "./actions";
import { kindIcon, runtimeStatus } from "./visuals";
import { providerOf, useProfiles } from "@/features/profiles/store";
import {
  DefaultAccountBadge,
  ProfileBadge,
} from "@/features/profiles/ProfileBadge";

export function SessionPane({ def }: { def: SessionDef }) {
  const ref = useRef<HTMLDivElement>(null);
  const runtime = useSessions((s) => s.runtime[def.id]);
  const focused = useSessions((s) => s.focusedId === def.id);
  const maximized = useSessions((s) => s.maximizedId === def.id);
  const focus = useSessions((s) => s.focus);
  const toggleMaximize = useSessions((s) => s.toggleMaximize);
  const rename = useSessions((s) => s.rename);
  const move = useSessions((s) => s.move);
  const groups = useWorkspace((s) => s.groups);
  const setProfile = useSessions((s) => s.setProfile);
  const allProfiles = useProfiles((s) => s.profiles);
  const provider = providerOf(def.kind);
  const accounts = provider
    ? allProfiles.filter((p) => p.provider === provider)
    : [];
  const profile = accounts.find((p) => p.id === def.profileId);
  const [renaming, setRenaming] = useState(false);
  const [searching, setSearching] = useState(false);
  const Icon = kindIcon[def.kind];
  const { status, label } = runtimeStatus(runtime);
  const state = runtime?.state ?? "stopped";
  const live = state === "running" || state === "starting";
  const opening = useSessions((s) => !!s.opening[def.id]) && live;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    terminals.attach(def.id, el);
    return () => terminals.detach(def.id);
  }, [def.id]);

  useEffect(() => {
    if (focused) terminals.focus(def.id);
  }, [focused, def.id]);

  const menu: MenuEntry[] = [
    { label: "Renommer", icon: <Pencil />, onSelect: () => setRenaming(true) },
    {
      label: "Rechercher",
      icon: <Search />,
      shortcut: "Ctrl Maj F",
      onSelect: () => setSearching(true),
    },
    {
      label: maximized ? "Restaurer la disposition" : "Agrandir",
      icon: <Maximize2 />,
      onSelect: () => toggleMaximize(def.id),
    },
    ...(groups.filter((g) => g.id !== def.groupId && !g.archived).length
      ? ([
          "separator",
          ...groups
            .filter((g) => g.id !== def.groupId && !g.archived)
            .map((g) => ({
              label: `Déplacer vers « ${g.name} »`,
              icon: <FolderInput />,
              onSelect: () => move(def.id, g.id),
            })),
        ] as MenuEntry[])
      : []),
    ...(provider && accounts.length
      ? ([
          "separator",
          ...[{ id: null, name: "habituel" }, ...accounts].map((p) => ({
            label: p.id ? `Compte « ${p.name} »` : "Compte habituel",
            icon: p.id ? <UserRound /> : <UserRound className="opacity-50" />,
            disabled: live || (def.profileId ?? null) === p.id,
            onSelect: () => setProfile(def.id, p.id),
          })),
        ] as MenuEntry[])
      : []),
    ...(provider && (def.agentSessionId || def.agentStartedAt)
      ? ([
          "separator",
          {
            label: "Nouvelle conversation au prochain lancement",
            icon: <MessageSquarePlus />,
            disabled: live,
            onSelect: () => void useSessions.getState().resetAgent(def.id),
          },
        ] as MenuEntry[])
      : []),
    "separator",
    live
      ? {
          label: "Arrêter le processus…",
          icon: <Square />,
          danger: true,
          onSelect: () => stopSession(def.id),
        }
      : {
          label: "Démarrer",
          icon: <Play />,
          onSelect: () => terminals.start(def.id),
        },
    {
      label: "Fermer le panneau",
      icon: <X />,
      shortcut: "Ctrl W",
      onSelect: () => closeSession(def.id),
    },
  ];

  return (
    <section
      aria-label={def.title}
      onFocusCapture={() => !focused && focus(def.id)}
      onMouseDown={() => !focused && focus(def.id)}
      onKeyDownCapture={(e) => {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
          e.preventDefault();
          e.stopPropagation();
          setSearching(true);
        }
      }}
      className={cx(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-[var(--terminal-bg)] transition-[border-color] duration-[var(--dur)]",
        focused ? "border-line-strong" : "border-line",
      )}
    >
      <ContextMenu items={menu}>
        <header className="flex h-[var(--row)] shrink-0 items-center gap-2 border-b border-line pr-1 pl-2.5">
          <Tooltip content={label} side="bottom">
            <span className="flex items-center">
              <StatusDot status={status} />
            </span>
          </Tooltip>
          <Icon
            size={13}
            className={def.kind === "codex" ? "text-fg" : "text-fg-3"}
          />
          {provider &&
            accounts.length > 0 &&
            (profile ? (
              <ProfileBadge profile={profile} size={16} />
            ) : (
              <DefaultAccountBadge size={16} />
            ))}
          {renaming ? (
            <input
              autoFocus
              defaultValue={def.title}
              maxLength={80}
              aria-label="Titre de la session"
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.currentTarget.value = def.title;
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => {
                setRenaming(false);
                const v = e.currentTarget.value.trim();
                if (v && v !== def.title) rename(def.id, v);
              }}
              className="h-[22px] min-w-0 flex-1 rounded-[4px] border border-accent bg-raised px-1.5 outline-none"
            />
          ) : (
            <span
              onDoubleClick={() => setRenaming(true)}
              className={cx(
                "min-w-0 flex-1 truncate text-[12.5px]",
                focused ? "font-medium text-fg" : "text-fg-2",
              )}
            >
              {def.title}
            </span>
          )}
          <div className="flex items-center opacity-70 transition-opacity hover:opacity-100">
            <IconButton
              label="Rechercher"
              shortcut="Ctrl Maj F"
              size="sm"
              onClick={() => setSearching((v) => !v)}
            >
              <Search size={13} />
            </IconButton>
            <IconButton
              label={maximized ? "Restaurer" : "Agrandir"}
              size="sm"
              onClick={() => toggleMaximize(def.id)}
            >
              {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </IconButton>
            <IconButton
              label="Fermer"
              shortcut="Ctrl W"
              size="sm"
              onClick={() => closeSession(def.id)}
            >
              <X size={14} />
            </IconButton>
          </div>
        </header>
      </ContextMenu>

      {searching && (
        <SearchBar id={def.id} onClose={() => setSearching(false)} />
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={ref} className="absolute inset-0 py-1.5 pl-2.5" />
        {opening && (
          <div
            role="status"
            className="anim-fade pointer-events-none absolute inset-0 z-10 flex bg-[var(--terminal-bg)] flex-col items-center justify-center gap-3 text-fg-3"
          >
            <Loader2 size={20} className="animate-spin text-accent" />
            <span className="text-[var(--fs-sm)]">
              Ouverture de {def.title}…
            </span>
          </div>
        )}
        {!live && (
          <div className="anim-fade absolute inset-x-0 bottom-0 flex items-center gap-3 border-t border-line bg-surface/95 px-3 py-2 backdrop-blur-sm">
            <StatusDot status={status} />
            <span className="min-w-0 flex-1 truncate text-[var(--fs-sm)] text-fg-2">
              {state === "stopped" ? "Session non démarrée" : label}
            </span>
            <Button
              variant={state === "stopped" ? "primary" : "secondary"}
              onClick={() => terminals.start(def.id)}
            >
              {state === "stopped" ? (
                <Play size={13} />
              ) : (
                <RotateCw size={13} />
              )}
              {state === "stopped" ? "Démarrer" : "Relancer"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function SearchBar({ id, onClose }: { id: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [miss, setMiss] = useState(false);
  const close = () => {
    terminals.clearSearch(id);
    onClose();
    terminals.focus(id);
  };
  const go = (back: boolean) => setMiss(!terminals.search(id, q, back));
  return (
    <div className="flex h-[var(--row)] shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
      <Search size={12} className="text-fg-3" />
      <input
        autoFocus
        value={q}
        placeholder="Rechercher dans le terminal"
        aria-label="Rechercher dans le terminal"
        onChange={(e) => {
          setQ(e.target.value);
          setMiss(!!e.target.value && !terminals.search(id, e.target.value));
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") go(e.shiftKey);
          if (e.key === "Escape") close();
        }}
        className={cx(
          "h-[22px] min-w-0 flex-1 bg-transparent text-[var(--fs-sm)] outline-none",
          miss && "text-err",
        )}
      />
      <IconButton label="Précédent" size="sm" onClick={() => go(true)}>
        <ChevronUp size={13} />
      </IconButton>
      <IconButton label="Suivant" size="sm" onClick={() => go(false)}>
        <ChevronDown size={13} />
      </IconButton>
      <IconButton label="Fermer la recherche" size="sm" onClick={close}>
        <X size={13} />
      </IconButton>
    </div>
  );
}
