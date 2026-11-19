import type { Category, Group } from "./ipc";

export function demoSeed(): { groups: Group[]; categories: Category[] } {
  const categories: Category[] = [
    {
      id: "cat-perso",
      name: "Projets personnels",
      position: 0,
      collapsed: false,
    },
  ];
  const mk = (
    id: string,
    name: string,
    color: string,
    icon: string,
    position: number,
    extra: Partial<Group> = {},
  ): Group => ({
    id,
    name,
    color,
    icon,
    categoryId: null,
    defaultProfileId: null,
    position,
    pinned: false,
    archived: false,
    layout: null,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  });
  return {
    categories,
    groups: [
      mk("g-travail", "Travail — Azure DevOps", "#3d6fb0", "briefcase", 0, {
        pinned: true,
      }),
      mk("g-cstonx", "CStonx", "#c0563f", "gamepad", 1, { pinned: true }),
      mk("g-arise", "Arise", "#2c6b63", "rocket", 2, {
        categoryId: "cat-perso",
      }),
      mk("g-vigie", "Vigie", "#6a5bb5", "shield", 3, {
        categoryId: "cat-perso",
      }),
      mk("g-vps", "Serveurs", "#5f6670", "server", 4),
      mk("g-old", "Prototype 2025", "#c28a2c", "flask", 5, { archived: true }),
    ],
  };
}
