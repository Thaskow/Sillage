import { t } from "@/lib/i18n";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Archive,
  ArchiveRestore,
  Bot,
  ChevronRight,
  Copy,
  FolderInput,
  FolderPlus,
  History,
  LayoutGrid,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings as SettingsIcon,
  Trash2,
  X,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cx } from "@/lib/cx";
import type { Group } from "@/lib/ipc";
import {
  IconButton,
  Kbd,
  StatusDot,
  Tooltip,
} from "@/design-system/primitives";
import { useUnseen } from "@/features/sessions/activity";
import {
  ConfirmDialog,
  ContextMenu,
  DropdownMenu,
  type MenuEntry,
} from "@/design-system/overlays";
import { GroupGlyph } from "@/design-system/group-visuals";
import { useUi, type View } from "@/app/ui-store";
import { groupName, SCRATCH_ID, useWorkspace } from "./store";
import { useSessions } from "@/features/sessions/store";
import { deleteGroup } from "@/features/sessions/actions";
import { buildSections, moveWithin, type Section } from "./sections";

const nav: Array<{ view: View; label: string; icon: ReactNode }> = [
  {
    view: "workspace",
    label: "Espace de travail",
    icon: <LayoutGrid size={15} />,
  },
  { view: "agents", label: "Agents", icon: <Bot size={15} /> },
  { view: "activity", label: "Activité", icon: <Activity size={15} /> },
  { view: "history", label: "Historique", icon: <History size={15} /> },
];

export function Sidebar({ width }: { width: number }) {
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const openGroupDialog = useUi((s) => s.openGroupDialog);
  const allGroups = useWorkspace((s) => s.groups);
  const groups = useMemo(
    () => allGroups.filter((g) => g.id !== SCRATCH_ID),
    [allGroups],
  );
  const scratch = allGroups.find((g) => g.id === SCRATCH_ID);
  const selectedId = useWorkspace((s) => s.selectedId);
  const scratchCount = useSessions(
    (s) => s.defs.filter((d) => d.groupId === SCRATCH_ID).length,
  );
  const categories = useWorkspace((s) => s.categories);
  const createCategory = useWorkspace((s) => s.createCategory);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [newCategoryId, setNewCategoryId] = useState<string | null>(null);
  const sections = useMemo(
    () => buildSections(groups, categories, query),
    [groups, categories, query],
  );
  const hasGroups = groups.length > 0;

  return (
    <aside
      style={{ width }}
      className="flex shrink-0 flex-col border-r border-line bg-surface"
    >
      <nav
        aria-label={t("Navigation principale")}
        className="flex flex-col gap-px px-2 pt-2"
      >
        {nav.map((n) => (
          <NavItem
            key={n.view}
            active={view === n.view}
            icon={n.icon}
            onClick={() => setView(n.view)}
          >
            {t(n.label)}
          </NavItem>
        ))}
      </nav>

      {scratch && (
        <div className="mt-3 px-2">
          <NavItem
            active={view === "workspace" && selectedId === SCRATCH_ID}
            icon={
              <GroupGlyph icon={scratch.icon} color={scratch.color} size={16} />
            }
            onClick={() => {
              useWorkspace.getState().select(SCRATCH_ID);
              setView("workspace");
            }}
          >
            <span className="flex-1">{groupName(scratch)}</span>
            {scratchCount > 0 && (
              <span className="text-[11px] text-fg-3 tabular-nums">
                {scratchCount}
              </span>
            )}
          </NavItem>
        </div>
      )}

      <div className="mt-3 flex h-[var(--row)] items-center gap-0.5 pr-2 pl-4">
        {searching ? (
          <div className="flex flex-1 items-center gap-1.5 rounded-md border border-line-strong bg-raised pr-0.5 pl-2">
            <Search size={12} className="text-fg-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Escape" && (setQuery(""), setSearching(false))
              }
              placeholder={t("Filtrer les groupes")}
              aria-label={t("Filtrer les groupes")}
              className="h-[24px] min-w-0 flex-1 bg-transparent text-[var(--fs-sm)] outline-none placeholder:text-fg-3"
            />
            <IconButton
              label={t("Effacer le filtre")}
              size="sm"
              onClick={() => (setQuery(""), setSearching(false))}
            >
              <X size={12} />
            </IconButton>
          </div>
        ) : (
          <>
            <span className="flex-1 text-[11px] font-medium tracking-[0.04em] text-fg-3 uppercase">
              {t("Groupes")}
            </span>
            <IconButton
              label={t("Filtrer")}
              size="sm"
              onClick={() => setSearching(true)}
            >
              <Search size={13} />
            </IconButton>
            <DropdownMenu
              align="end"
              items={[
                {
                  label: t("Nouveau groupe"),
                  icon: <Plus />,
                  shortcut: t("Ctrl Maj N"),
                  onSelect: () => openGroupDialog({ mode: "create" }),
                },
                {
                  label: t("Nouvelle catégorie"),
                  icon: <FolderPlus />,
                  onSelect: async () => {
                    const c = await createCategory(t("Nouvelle catégorie"));
                    if (c) setNewCategoryId(c.id);
                  },
                },
              ]}
            >
              <IconButton label={t("Ajouter")} size="sm">
                <Plus size={14} />
              </IconButton>
            </DropdownMenu>
          </>
        )}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        role="tree"
        aria-label={t("Groupes")}
      >
        {!hasGroups ? (
          <button
            onClick={() => openGroupDialog({ mode: "create" })}
            className="transition-quick mt-1 flex w-full flex-col items-start gap-0.5 rounded-lg border border-dashed border-line-strong px-3 py-3 text-left text-fg-2 hover:bg-hover"
          >
            <span className="font-medium text-fg">
              {t("Créer un premier groupe")}
            </span>
            <span className="text-[var(--fs-sm)]">
              {t("Un espace pour vos agents et vos terminaux.")}
            </span>
          </button>
        ) : (
          sections.map((s) => (
            <SectionBlock
              key={s.key}
              section={s}
              sections={sections}
              filtering={!!query}
              editTitle={newCategoryId === s.key}
              onEdited={() => setNewCategoryId(null)}
            />
          ))
        )}
        {hasGroups && query && sections.every((s) => s.groups.length === 0) && (
          <p className="px-2 py-3 text-[var(--fs-sm)] text-fg-3">
            {t("Aucun groupe ne correspond à « {query} ».", { query })}
          </p>
        )}
      </div>

      <div className="border-t border-line p-2">
        <NavItem
          active={view === "settings"}
          icon={<SettingsIcon size={15} />}
          onClick={() => setView("settings")}
        >
          {t("Paramètres")}
        </NavItem>
      </div>
    </aside>
  );
}

function NavItem({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "transition-quick flex h-[var(--row)] w-full items-center gap-2.5 rounded-md px-2 text-left",
        active
          ? "bg-active font-medium text-fg"
          : "text-fg-2 hover:bg-hover hover:text-fg",
      )}
    >
      <span className={active ? "text-accent" : "text-fg-3"}>{icon}</span>
      {children}
    </button>
  );
}

function SectionBlock({
  section,
  sections,
  filtering,
  editTitle,
  onEdited,
}: {
  section: Section;
  sections: Section[];
  filtering: boolean;
  editTitle: boolean;
  onEdited: () => void;
}) {
  const reorder = useWorkspace((s) => s.reorder);
  const toggleCategory = useWorkspace((s) => s.toggleCategory);
  const renameCategory = useWorkspace((s) => s.renameCategory);
  const deleteCategory = useWorkspace((s) => s.deleteCategory);
  const [renaming, setRenaming] = useState(editTitle);
  const [confirm, setConfirm] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const cat = section.category;
  const collapsed = !!cat?.collapsed && !filtering;
  const sortable = !filtering && section.key !== "archived";
  const isDefault = section.key === "loose";
  if (isDefault && section.groups.length === 0 && sections.length > 1)
    return null;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    reorder(
      moveWithin(sections, section.key, String(e.active.id), String(e.over.id)),
    );
  };

  const header = (
    <div className="group/sec flex h-[var(--row-sm)] items-center gap-1 pr-1 pl-2 text-[11.5px] text-fg-3">
      {cat ? (
        <button
          onClick={() => toggleCategory(cat.id)}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-sm hover:text-fg-2"
        >
          <ChevronRight
            size={12}
            className={cx(
              "transition-quick shrink-0",
              !collapsed && "rotate-90",
            )}
          />
          {renaming ? (
            <InlineName
              initial={cat.name}
              onDone={(name) => {
                setRenaming(false);
                onEdited();
                if (name && name !== cat.name) renameCategory(cat.id, name);
              }}
            />
          ) : (
            <span className="truncate font-medium">{section.title}</span>
          )}
        </button>
      ) : (
        <span className="flex-1 truncate pl-[2px] font-medium">
          {section.title}
        </span>
      )}
      {cat && !renaming && (
        <span className="text-[11px] tabular-nums opacity-0 group-hover/sec:opacity-100">
          {section.groups.length}
        </span>
      )}
    </div>
  );

  return (
    <div className="mt-2 first:mt-0" role="group" aria-label={section.title}>
      {cat ? (
        <ContextMenu
          items={[
            {
              label: t("Renommer"),
              icon: <Pencil />,
              onSelect: () => setRenaming(true),
            },
            {
              label: t("Supprimer la catégorie"),
              icon: <Trash2 />,
              danger: true,
              onSelect: () => setConfirm(true),
            },
          ]}
        >
          {header}
        </ContextMenu>
      ) : (
        (section.key !== "loose" || sections.length > 1) && header
      )}
      {!collapsed && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={section.groups.map((g) => g.id)}
            strategy={verticalListSortingStrategy}
          >
            {section.groups.map((g, i) => (
              <GroupRow key={g.id} group={g} index={i} sortable={sortable} />
            ))}
          </SortableContext>
        </DndContext>
      )}
      {cat && !collapsed && section.groups.length === 0 && (
        <p className="py-1 pl-7 text-[var(--fs-sm)] text-fg-3">
          {t("Vide — déplacez un groupe ici.")}
        </p>
      )}
      {cat && (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={t("Supprimer « {name} » ?", { name: cat.name })}
          description={t(
            "Les groupes de cette catégorie sont conservés et retournent dans la liste principale.",
          )}
          confirmLabel={t("Supprimer")}
          onConfirm={() => deleteCategory(cat.id)}
        />
      )}
    </div>
  );
}

function GroupRow({
  group,
  index,
  sortable,
}: {
  group: Group;
  index: number;
  sortable: boolean;
}) {
  const selected = useWorkspace((s) => s.selectedId === group.id);
  const unseen = useUnseen(group.id);
  const view = useUi((s) => s.view);
  const select = useWorkspace((s) => s.select);
  const setView = useUi((s) => s.setView);
  const categories = useWorkspace((s) => s.categories);
  const updateGroup = useWorkspace((s) => s.updateGroup);
  const duplicateGroup = useWorkspace((s) => s.duplicateGroup);
  const openGroupDialog = useUi((s) => s.openGroupDialog);
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: group.id,
    disabled: !sortable || renaming,
  });

  const open = () => {
    select(group.id);
    setView("workspace");
  };

  const moveTargets: MenuEntry[] = [
    ...categories
      .filter((c) => c.id !== group.categoryId)
      .map((c) => ({
        label: t("Déplacer vers « {name} »", { name: c.name }),
        icon: <FolderInput />,
        onSelect: () =>
          updateGroup(group.id, { categoryId: c.id, pinned: false }),
      })),
    ...(group.categoryId
      ? [
          {
            label: t("Retirer de la catégorie"),
            icon: <FolderInput />,
            onSelect: () => updateGroup(group.id, { categoryId: null }),
          },
        ]
      : []),
  ];

  const items: MenuEntry[] = [
    { label: t("Ouvrir"), icon: <LayoutGrid />, onSelect: open },
    {
      label: t("Renommer"),
      icon: <Pencil />,
      shortcut: "F2",
      onSelect: () => setRenaming(true),
    },
    {
      label: t("Apparence…"),
      icon: <Pencil />,
      onSelect: () => openGroupDialog({ mode: "edit", groupId: group.id }),
    },
    group.pinned
      ? {
          label: t("Désépingler"),
          icon: <PinOff />,
          onSelect: () => updateGroup(group.id, { pinned: false }),
        }
      : {
          label: t("Épingler"),
          icon: <Pin />,
          onSelect: () => updateGroup(group.id, { pinned: true }),
        },
    {
      label: t("Dupliquer la configuration"),
      icon: <Copy />,
      onSelect: () => duplicateGroup(group.id),
    },
    ...(moveTargets.length
      ? (["separator", ...moveTargets] as MenuEntry[])
      : []),
    "separator",
    group.archived
      ? {
          label: t("Désarchiver"),
          icon: <ArchiveRestore />,
          onSelect: () => updateGroup(group.id, { archived: false }),
        }
      : {
          label: t("Archiver"),
          icon: <Archive />,
          onSelect: () =>
            updateGroup(group.id, { archived: true, pinned: false }),
        },
    {
      label: t("Supprimer…"),
      icon: <Trash2 />,
      danger: true,
      onSelect: () => setConfirm(true),
    },
  ];

  const isCurrent = selected && view === "workspace";
  const keyRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <ContextMenu items={items}>
        <div
          ref={(n) => {
            setNodeRef(n);
            keyRef.current = n;
          }}
          {...attributes}
          {...listeners}
          role="treeitem"
          aria-selected={isCurrent}
          aria-roledescription={undefined}
          tabIndex={0}
          style={{ transform: CSS.Transform.toString(transform), transition }}
          onClick={open}
          onDoubleClick={() => setRenaming(true)}
          onKeyDown={(e) => {
            if (renaming) return;
            if (e.key === "Enter") open();
            else if (e.key === "F2") setRenaming(true);
            else listeners?.onKeyDown?.(e);
          }}
          className={cx(
            "group/row transition-quick relative flex h-[var(--row)] cursor-default items-center gap-2.5 rounded-md pr-1.5 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
            isCurrent ? "bg-active" : "hover:bg-hover",
            group.archived && "opacity-60",
            isDragging && "z-10 bg-raised shadow-pop",
          )}
        >
          <GroupGlyph icon={group.icon} color={group.color} size={20} />
          {renaming ? (
            <InlineName
              initial={group.name}
              onDone={(name) => {
                setRenaming(false);
                if (name && name !== group.name)
                  updateGroup(group.id, { name });
                keyRef.current?.focus();
              }}
            />
          ) : (
            <span
              className={cx(
                "min-w-0 flex-1 truncate",
                isCurrent
                  ? "font-medium text-fg"
                  : "text-fg-2 group-hover/row:text-fg",
              )}
            >
              {group.name}
            </span>
          )}
          {!renaming && unseen > 0 && (
            <Tooltip
              content={
                unseen > 1
                  ? `${unseen} agents vous attendent`
                  : "Un agent vous attend"
              }
              side="right"
            >
              <span className="flex">
                <StatusDot status="waiting" />
              </span>
            </Tooltip>
          )}
          {!renaming && group.pinned && index < 9 && (
            <Tooltip content={t("Accès rapide")} side="right">
              <span className="opacity-0 group-hover/row:opacity-100">
                <Kbd>Ctrl {index + 1}</Kbd>
              </span>
            </Tooltip>
          )}
        </div>
      </ContextMenu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("Supprimer « {name} » ?", { name: group.name })}
        description={t(
          "La configuration et la disposition du groupe seront supprimées. Les historiques Claude Code et vos fichiers ne sont pas touchés. Préférez l'archivage pour le retrouver plus tard.",
        )}
        confirmLabel={t("Supprimer le groupe")}
        onConfirm={() => deleteGroup(group.id)}
      />
    </>
  );
}

function InlineName({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (name: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v === null ? null : v.trim() || null);
  };
  return (
    <input
      autoFocus
      value={value}
      maxLength={80}
      aria-label={t("Nouveau nom")}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(value)}
      className="h-[22px] min-w-0 flex-1 rounded-[4px] border border-accent bg-raised px-1.5 text-fg outline-none"
    />
  );
}
