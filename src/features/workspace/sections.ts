import type { Category, Group } from "@/lib/ipc";

export interface Section {
  key: string;
  title: string;
  category: Category | null;
  groups: Group[];
}

export function buildSections(
  groups: Group[],
  categories: Category[],
  query: string,
): Section[] {
  const q = query.trim().toLocaleLowerCase("fr");
  const match = (g: Group) => !q || g.name.toLocaleLowerCase("fr").includes(q);
  const active = groups.filter((g) => !g.archived && match(g));
  const sections: Section[] = [];
  const pinned = active.filter((g) => g.pinned);
  if (pinned.length)
    sections.push({
      key: "pinned",
      title: "Épinglés",
      category: null,
      groups: pinned,
    });
  for (const c of categories) {
    const inCat = active.filter((g) => !g.pinned && g.categoryId === c.id);
    if (inCat.length || !q)
      sections.push({ key: c.id, title: c.name, category: c, groups: inCat });
  }
  const known = new Set(categories.map((c) => c.id));
  const loose = active.filter(
    (g) => !g.pinned && (!g.categoryId || !known.has(g.categoryId)),
  );
  sections.push({
    key: "loose",
    title: "Groupes",
    category: null,
    groups: loose,
  });
  const archived = groups.filter((g) => g.archived && match(g));
  if (archived.length)
    sections.push({
      key: "archived",
      title: "Archivés",
      category: null,
      groups: archived,
    });
  return sections;
}

export function moveWithin(
  sections: Section[],
  sectionKey: string,
  fromId: string,
  toId: string,
): string[] {
  return sections
    .filter((s) => s.key !== "archived")
    .flatMap((s) => {
      const ids = s.groups.map((g) => g.id);
      if (s.key !== sectionKey) return ids;
      const from = ids.indexOf(fromId);
      const to = ids.indexOf(toId);
      if (from < 0 || to < 0) return ids;
      ids.splice(to, 0, ...ids.splice(from, 1));
      return ids;
    });
}

export function favoriteOrder(
  groups: Group[],
  categories: Category[],
): Group[] {
  return buildSections(groups, categories, "")
    .filter((s) => s.key !== "archived" && !s.category?.collapsed)
    .flatMap((s) => s.groups);
}
