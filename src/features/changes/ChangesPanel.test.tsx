import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const status = vi.fn();
const diff = vi.fn();
vi.mock("./ipc", () => ({
  changesIpc: {
    status: (id: string) => status(id),
    diff: (id: string, path: string) => diff(id, path),
  },
}));

import * as RTooltip from "@radix-ui/react-tooltip";
import { ChangesPanel } from "./ChangesPanel";
import { useSessions } from "@/features/sessions/store";

const session = { id: "s1", title: "Claude Code" } as never;
const renderPanel = () =>
  render(
    <RTooltip.Provider>
      <ChangesPanel session={session} />
    </RTooltip.Provider>,
  );

describe("ChangesPanel", () => {
  beforeEach(() => {
    status.mockReset();
    diff.mockReset();
    useSessions.setState({ runtime: { s1: { state: "running" } } });
  });

  it("liste les fichiers et affiche le diff au clic", async () => {
    status.mockResolvedValue({
      status: "ok",
      root: "C:/repo",
      branch: "main",
      truncated: false,
      files: [
        {
          path: "src/a.ts",
          origPath: null,
          kind: "modified",
          staged: false,
          unstaged: true,
        },
      ],
    });
    diff.mockResolvedValue({
      path: "src/a.ts",
      text: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
      truncated: false,
      binary: false,
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /a\.ts/ }));
    expect(await screen.findByText("new")).toBeTruthy();
    expect(screen.getByText("old")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(diff).toHaveBeenCalledWith("s1", "src/a.ts");
  });

  it("signale un dossier hors dépôt et rafraîchit quand l'agent a terminé", async () => {
    status.mockResolvedValue({ status: "notRepo", cwd: "C:/tmp" });
    renderPanel();
    expect(await screen.findByText(/n'est pas un dépôt git/)).toBeTruthy();
    expect(status).toHaveBeenCalledTimes(1);
    await act(async () => {
      useSessions.setState({
        runtime: { s1: { state: "running", activity: "done" } },
      });
    });
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("signale git absent", async () => {
    status.mockResolvedValue({ status: "noGit" });
    renderPanel();
    expect(await screen.findByText(/Git est introuvable/)).toBeTruthy();
  });
});
