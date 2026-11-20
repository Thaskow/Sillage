import { describe, expect, it } from "vitest";
import { parseDiff, splitPath } from "./diff";

const sample = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 one
--- not a header
+two
\\ No newline at end of file
`;

describe("parseDiff", () => {
  it("classe les lignes et numérote", () => {
    const d = parseDiff(sample);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.lines.map((l) => l.kind)).toEqual([
      "meta",
      "meta",
      "meta",
      "meta",
      "hunk",
      "ctx",
      "del",
      "add",
      "meta",
    ]);
    expect(d.lines[5]).toMatchObject({ text: "one", oldNo: 1, newNo: 1 });
    expect(d.lines[6]).toMatchObject({ text: "-- not a header", oldNo: 2 });
    expect(d.lines[7]).toMatchObject({ text: "two", newNo: 2 });
  });

  it("gère un diff vide", () => {
    expect(parseDiff("")).toEqual({ lines: [], added: 0, removed: 0 });
  });
});

describe("splitPath", () => {
  it("sépare dossier et nom", () => {
    expect(splitPath("src/a/b.ts")).toEqual({ dir: "src/a/", name: "b.ts" });
    expect(splitPath("b.ts")).toEqual({ dir: "", name: "b.ts" });
  });
});
