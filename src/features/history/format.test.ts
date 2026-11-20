import { describe, expect, it } from "vitest";
import {
  dayLabel,
  groupByDay,
  projectName,
  resumeCommand,
  splitSnippet,
} from "./format";

describe("history format", () => {
  it("splits snippet markers into highlighted segments", () => {
    expect(splitSnippet("…le \u0002bug\u0003 de\nconnexion")).toEqual([
      { text: "…le ", mark: false },
      { text: "bug", mark: true },
      { text: " de connexion", mark: false },
    ]);
  });

  it("names the project after the last folder", () => {
    expect(projectName("C:\\dev\\sillage\\")).toBe("sillage");
    expect(projectName("/home/me/app")).toBe("app");
    expect(projectName(null)).toBe("Dossier inconnu");
  });

  it("labels and groups by day, newest first", () => {
    const now = new Date(2026, 10, 20, 15).getTime();
    const today = new Date(2026, 10, 20, 9).getTime();
    const yesterday = new Date(2026, 10, 19, 23).getTime();
    expect(dayLabel(today, now)).toBe("Aujourd'hui");
    expect(dayLabel(yesterday, now)).toBe("Hier");
    const groups = groupByDay(
      [
        { updatedAt: yesterday },
        { updatedAt: today },
        { updatedAt: today + 1 },
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ["Aujourd'hui", 2],
      ["Hier", 1],
    ]);
    expect(groups[0]!.items[0]!.updatedAt).toBe(today + 1);
  });

  it("builds a PowerShell resume command", () => {
    expect(
      resumeCommand(
        { tool: "claude", sessionId: "ab-1", cwd: "C:\\it's" },
        "D:\\cfg",
      ),
    ).toBe(
      "Set-Location -LiteralPath 'C:\\it''s'; $env:CLAUDE_CONFIG_DIR = 'D:\\cfg'; claude --resume ab-1",
    );
    expect(resumeCommand({ tool: "codex", sessionId: "x", cwd: null })).toBe(
      "codex resume x",
    );
  });
});
