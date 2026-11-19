import { describe, expect, it } from "vitest";
import { demoSeed } from "@/lib/demo-seed";
import { buildSections, moveWithin } from "./sections";

describe("buildSections", () => {
  const { groups, categories } = demoSeed();

  it("orders pinned, categories, loose then archived", () => {
    const s = buildSections(groups, categories, "");
    expect(s.map((x) => x.key)).toEqual([
      "pinned",
      "cat-perso",
      "loose",
      "archived",
    ]);
    expect(s[0]!.groups.map((g) => g.name)).toEqual([
      "Travail — Azure DevOps",
      "CStonx",
    ]);
    expect(s[1]!.groups.map((g) => g.name)).toEqual(["Arise", "Vigie"]);
  });

  it("filters case-insensitively and hides empty categories", () => {
    const s = buildSections(groups, categories, "vig");
    expect(s.flatMap((x) => x.groups).map((g) => g.name)).toEqual(["Vigie"]);
  });

  it("moves a group within its section and keeps a full order", () => {
    const s = buildSections(groups, categories, "");
    const ids = moveWithin(s, "cat-perso", "g-vigie", "g-arise");
    expect(ids).toEqual([
      "g-travail",
      "g-cstonx",
      "g-vigie",
      "g-arise",
      "g-vps",
    ]);
  });
});
