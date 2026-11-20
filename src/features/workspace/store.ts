import { t } from "@/lib/i18n";
import { create } from "zustand";
import {
  errorMessage,
  ipc,
  type Category,
  type Group,
  type GroupPatch,
  type NewGroup,
} from "@/lib/ipc";
import { toast } from "@/design-system/toast";

interface WorkspaceState {
  groups: Group[];
  categories: Category[];
  loaded: boolean;
  selectedId: string | null;
  load: () => Promise<void>;
  select: (id: string | null) => void;
  createGroup: (g: NewGroup) => Promise<Group | null>;
  updateGroup: (id: string, patch: GroupPatch) => Promise<boolean>;
  deleteGroup: (id: string) => Promise<boolean>;
  duplicateGroup: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  createCategory: (name: string) => Promise<Category | null>;
  renameCategory: (id: string, name: string) => Promise<void>;
  toggleCategory: (id: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
}

const fail = (title: string) => (e: unknown) => {
  toast.error(t(title), errorMessage(e));
  return null;
};

export const SCRATCH_ID = "libre";

export function groupName(g: Group): string {
  return g.id === SCRATCH_ID && g.name === "Espace libre"
    ? t("Espace libre")
    : g.name;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  groups: [],
  categories: [],
  loaded: false,
  selectedId: null,

  load: async () => {
    const { groups, categories } = await ipc.listWorkspace();
    const firstActive = groups.find((g) => !g.archived && g.id !== SCRATCH_ID);
    set({
      groups,
      categories,
      loaded: true,
      selectedId: get().selectedId ?? firstActive?.id ?? null,
    });
  },

  select: (id) => set({ selectedId: id }),

  createGroup: async (g) => {
    const created = await ipc.createGroup(g).catch(fail("Groupe non créé"));
    if (created)
      set((s) => ({ groups: [...s.groups, created], selectedId: created.id }));
    return created;
  },

  updateGroup: async (id, patch) => {
    const before = get().groups;
    set({ groups: before.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
    const updated = await ipc
      .updateGroup(id, patch)
      .catch(fail("Modification annulée"));
    const previous = before.find((g) => g.id === id);
    set({
      groups: get().groups.map((g) =>
        g.id === id ? (updated ?? previous ?? g) : g,
      ),
    });
    return !!updated;
  },

  deleteGroup: async (id) => {
    const ok = await ipc
      .deleteGroup(id)
      .then(() => true, fail("Suppression impossible"));
    if (!ok) return false;
    set((s) => {
      const groups = s.groups.filter((g) => g.id !== id);
      const selectedId =
        s.selectedId === id
          ? (groups.find((g) => !g.archived)?.id ?? null)
          : s.selectedId;
      return { groups, selectedId };
    });
    return true;
  },

  duplicateGroup: async (id) => {
    const copy = await ipc
      .duplicateGroup(id)
      .catch(fail("Duplication impossible"));
    if (copy)
      set((s) => ({ groups: [...s.groups, copy], selectedId: copy.id }));
  },

  reorder: async (ids) => {
    const before = get().groups;
    const byId = new Map(before.map((g) => [g.id, g]));
    const moved = ids.map((id, i) => ({ ...byId.get(id)!, position: i }));
    const rest = before.filter((g) => !ids.includes(g.id));
    set({ groups: [...moved, ...rest] });
    const saved = await ipc
      .reorderGroups([...ids, ...rest.map((g) => g.id)])
      .catch(fail("Ordre non enregistré"));
    set({ groups: saved ?? before });
  },

  createCategory: async (name) => {
    const c = await ipc.createCategory(name).catch(fail("Catégorie non créée"));
    if (c) set((s) => ({ categories: [...s.categories, c] }));
    return c;
  },

  renameCategory: async (id, name) => {
    const ok = await ipc
      .updateCategory(id, name)
      .then(() => true, fail("Renommage impossible"));
    if (ok)
      set((s) => ({
        categories: s.categories.map((c) => (c.id === id ? { ...c, name } : c)),
      }));
  },

  toggleCategory: async (id) => {
    const c = get().categories.find((x) => x.id === id);
    if (!c) return;
    set((s) => ({
      categories: s.categories.map((x) =>
        x.id === id ? { ...x, collapsed: !x.collapsed } : x,
      ),
    }));
    const ok = await ipc
      .updateCategory(id, undefined, !c.collapsed)
      .then(() => true, fail("État non enregistré"));
    if (!ok)
      set((s) => ({
        categories: s.categories.map((x) =>
          x.id === id ? { ...x, collapsed: c.collapsed } : x,
        ),
      }));
  },

  deleteCategory: async (id) => {
    const ok = await ipc
      .deleteCategory(id)
      .then(() => true, fail("Suppression impossible"));
    if (ok)
      set((s) => ({
        categories: s.categories.filter((c) => c.id !== id),
        groups: s.groups.map((g) =>
          g.categoryId === id ? { ...g, categoryId: null } : g,
        ),
      }));
  },
}));

export const selectSelectedGroup = (s: WorkspaceState) =>
  s.groups.find((g) => g.id === s.selectedId) ?? null;
