import { Command } from "cmdk";
import * as RDialog from "@radix-ui/react-dialog";
import {
  Activity,
  Bot,
  History,
  LayoutGrid,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import type { ReactNode } from "react";
import { GroupGlyph } from "@/design-system/group-visuals";
import { Kbd } from "@/design-system/primitives";
import { useUi } from "@/app/ui-store";
import { useWorkspace } from "@/features/workspace/store";
import { useSettings } from "@/features/settings/store";

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setPalette = useUi((s) => s.setPalette);
  const setView = useUi((s) => s.setView);
  const openGroupDialog = useUi((s) => s.openGroupDialog);
  const groups = useWorkspace((s) => s.groups);
  const select = useWorkspace((s) => s.select);
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);

  const run = (fn: () => void) => () => {
    setPalette(false);
    fn();
  };
  const dark = document.documentElement.dataset.theme === "dark";

  return (
    <RDialog.Root open={open} onOpenChange={setPalette}>
      <RDialog.Portal>
        <RDialog.Overlay className="anim-fade fixed inset-0 z-40 bg-[var(--scrim)]" />
        <RDialog.Content
          aria-describedby={undefined}
          className="anim-pop fixed top-[14%] left-1/2 z-50 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-raised shadow-dialog"
        >
          <RDialog.Title className="sr-only">Recherche globale</RDialog.Title>
          <Command label="Recherche globale" loop>
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search size={15} className="text-fg-3" />
              <Command.Input
                autoFocus
                placeholder="Rechercher un groupe ou une action…"
                className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-3"
              />
              <Kbd>Échap</Kbd>
            </div>
            <Command.List className="max-h-[360px] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-fg-3">
                Aucun résultat.
              </Command.Empty>
              {groups.length > 0 && (
                <Command.Group heading="Groupes" className={groupCls}>
                  {groups.map((g) => (
                    <Item
                      key={g.id}
                      value={`groupe ${g.name} ${g.id}`}
                      icon={
                        <GroupGlyph icon={g.icon} color={g.color} size={18} />
                      }
                      hint={g.archived ? "Archivé" : undefined}
                      onSelect={run(() => {
                        select(g.id);
                        setView("workspace");
                      })}
                    >
                      {g.name}
                    </Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Actions" className={groupCls}>
                <Item
                  value="nouveau groupe créer"
                  icon={<Plus size={15} />}
                  onSelect={run(() => openGroupDialog({ mode: "create" }))}
                >
                  Nouveau groupe
                </Item>
                <Item
                  value="espace de travail workspace"
                  icon={<LayoutGrid size={15} />}
                  onSelect={run(() => setView("workspace"))}
                >
                  Aller à l'espace de travail
                </Item>
                <Item
                  value="agents supervision"
                  icon={<Bot size={15} />}
                  onSelect={run(() => setView("agents"))}
                >
                  Aller aux agents
                </Item>
                <Item
                  value="activité notifications"
                  icon={<Activity size={15} />}
                  onSelect={run(() => setView("activity"))}
                >
                  Aller à l'activité
                </Item>
                <Item
                  value="historique conversations"
                  icon={<History size={15} />}
                  onSelect={run(() => setView("history"))}
                >
                  Aller à l'historique
                </Item>
                <Item
                  value="paramètres réglages"
                  icon={<Settings size={15} />}
                  onSelect={run(() => setView("settings"))}
                >
                  Ouvrir les paramètres
                </Item>
                <Item
                  value="thème clair sombre basculer"
                  icon={dark ? <Sun size={15} /> : <Moon size={15} />}
                  onSelect={run(() =>
                    update({ theme: dark ? "light" : "dark" }),
                  )}
                >
                  {dark ? "Passer en thème clair" : "Passer en thème sombre"}
                </Item>
                <Item
                  value="barre latérale sidebar"
                  icon={<PanelLeft size={15} />}
                  hint="Ctrl B"
                  onSelect={run(() =>
                    update({ sidebarVisible: !settings.sidebarVisible }),
                  )}
                >
                  {settings.sidebarVisible
                    ? "Masquer la barre latérale"
                    : "Afficher la barre latérale"}
                </Item>
              </Command.Group>
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

const groupCls =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-3";

function Item({
  value,
  icon,
  hint,
  onSelect,
  children,
}: {
  value: string;
  icon: ReactNode;
  hint?: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-fg-2 data-[selected=true]:bg-hover data-[selected=true]:text-fg"
    >
      <span className="flex w-[18px] justify-center text-fg-3">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-[11px] text-fg-3">{hint}</span>}
    </Command.Item>
  );
}
