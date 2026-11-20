import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { installMockBackend } from "@/lib/mock-backend";
import { demoSeed } from "@/lib/demo-seed";
import { useWorkspace } from "@/features/workspace/store";
import { useSettings, applyAppearance } from "@/features/settings/store";
import { useUi } from "./ui-store";
import { useSessions } from "@/features/sessions/store";
import { useProfiles } from "@/features/profiles/store";
import { resumeSessions } from "@/features/sessions/actions";

vi.mock("@/features/sessions/terminal-registry", () => ({
  terminals: {
    attach: vi.fn(),
    detach: vi.fn(),
    focus: vi.fn(),
    search: vi.fn(() => true),
    clearSearch: vi.fn(),
    dispose: vi.fn(),
    retheme: vi.fn(),
    onExit: vi.fn(),
    start: vi.fn(async (id: string) => {
      const { useSessions } = await import("@/features/sessions/store");
      useSessions
        .getState()
        .setRuntime(id, { state: "running", startedAt: Date.now() });
    }),
  },
}));

async function boot(seed = demoSeed()) {
  installMockBackend(seed);
  useWorkspace.setState({
    groups: [],
    categories: [],
    loaded: false,
    selectedId: null,
  });
  useUi.setState({
    view: "workspace",
    agentsTab: "usage",
    paletteOpen: false,
    groupDialog: null,
  });
  useSessions.setState({
    defs: [],
    kinds: [],
    runtime: {},
    focusedId: null,
    maximizedId: null,
  });
  await Promise.all([
    useSettings.getState().load(),
    useWorkspace.getState().load(),
    useSessions.getState().load(),
    useProfiles.getState().load(),
  ]);
  render(<App />);
}

describe("App", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("shows the first group with its empty session state", async () => {
    await boot();
    expect(
      screen.getByRole("heading", { name: "Travail — Azure DevOps" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Aucune session dans ce groupe"),
    ).toBeInTheDocument();
  });

  it("starts Claude and PowerShell side by side in the group", async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole("button", { name: /Claude Code/ }));
    await screen.findByRole("region", { name: "Claude Code" });
    await user.keyboard("{Control>}{Shift>}t{/Shift}{/Control}");
    await screen.findByRole("region", { name: "PowerShell" });
    expect(
      screen.getAllByRole("separator", { name: "Redimensionner les panneaux" }),
    ).toHaveLength(1);
    const defs = useSessions.getState().defs;
    expect(defs.map((d) => d.kind)).toEqual(["claude", "powershell"]);
    expect(
      defs.every(
        (d) => useSessions.getState().runtime[d.id]?.state === "running",
      ),
    ).toBe(true);
  });

  it("keeps sessions when switching groups and asks before closing a running one", async () => {
    const user = userEvent.setup();
    await boot();
    await user.keyboard("{Control>}{Shift>}t{/Shift}{/Control}");
    await screen.findByRole("region", { name: "PowerShell" });
    await user.click(screen.getByRole("treeitem", { name: /Vigie/ }));
    expect(
      screen.queryByRole("region", { name: "PowerShell" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("treeitem", { name: /Travail/ }));
    const pane = await screen.findByRole("region", { name: "PowerShell" });
    await user.click(within(pane).getByRole("button", { name: "Fermer" }));
    const dialog = await screen.findByRole("dialog");
    expect(useSessions.getState().defs).toHaveLength(1);
    await user.click(
      within(dialog).getByRole("button", { name: "Arrêter et fermer" }),
    );
    await waitFor(() => expect(useSessions.getState().defs).toHaveLength(0));
  });

  it("reopens only sessions that were running when the app closed", async () => {
    await boot();
    const base = {
      groupId: "g",
      kind: "claude" as const,
      title: "Claude Code",
      profileId: null,
      cwd: null,
      command: null,
      args: [],
      persistent: false,
      position: 0,
      createdAt: 0,
      lastActiveAt: null,
      agentSessionId: null,
      agentStartedAt: null,
    };
    const a = { ...base, id: "a", resume: true };
    const b = { ...base, id: "b", resume: false };
    useSessions.setState({ defs: [a, b], runtime: {} });
    resumeSessions();
    await vi.waitFor(() =>
      expect(useSessions.getState().runtime[a.id]?.state).toBe("running"),
    );
    expect(useSessions.getState().runtime[b.id]).toBeUndefined();
  });

  it("lists agents across groups", async () => {
    const user = userEvent.setup();
    await boot();
    await user.keyboard("{Control>}t{/Control}");
    await screen.findByRole("region", { name: "Claude Code" });
    useUi.getState().setView("activity");
    expect(
      await screen.findByRole("heading", { name: "Activité" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Claude Code · compte habituel · Processus actif"),
    ).toBeInTheDocument();
  });

  it("adds a Claude account and opens a session with it", async () => {
    const user = userEvent.setup();
    await boot();
    useUi.getState().openAgents("settings");
    await user.click(
      await screen.findByRole("button", { name: /Ajouter un compte/ }),
    );
    const dialog = await screen.findByRole("dialog");
    const nameInput = within(dialog).getByLabelText("Nom");
    expect((nameInput as HTMLInputElement).value).toMatch(/^Claude \S+$/);
    await user.clear(nameInput);
    await user.type(nameInput, "Perso");
    await user.click(within(dialog).getByRole("button", { name: "Ajouter" }));
    expect(await screen.findByText("Non connecté")).toBeInTheDocument();
    expect(
      screen.getByText(/Partagé avec la configuration habituelle/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Se connecter/ }));
    const pane = await screen.findByRole("region", { name: "Claude Code" });
    expect(within(pane).getByLabelText("Compte Perso")).toBeInTheDocument();
    const def = useSessions.getState().defs.find((d) => d.kind === "claude");
    expect(def?.profileId).toBe(useProfiles.getState().profiles[0]?.id);
  });

  it("shows token usage and plan limits per account", async () => {
    const user = userEvent.setup();
    await boot();
    useUi.getState().setView("agents");
    await user.click(await screen.findByRole("tab", { name: "Consommation" }));
    const codex = await screen.findByRole("region", {
      name: "Consommation compte habituel Codex",
    });
    expect(
      within(codex).getByRole("meter", { name: "Fenêtre 5 h" }),
    ).toHaveAttribute("aria-valuenow", "42");
    const claude = screen.getByRole("region", {
      name: "Consommation compte habituel Claude Code",
    });
    expect(
      within(claude).getByRole("meter", { name: "Fenêtre 5 h" }),
    ).toHaveAttribute("aria-valuenow", "37");
    expect(within(claude).getByText("1,2 M")).toBeInTheDocument();
  });

  it("creates a group from the empty state", async () => {
    const user = userEvent.setup();
    await boot({ groups: [], categories: [] });
    await user.click(screen.getByRole("button", { name: /Créer un groupe/ }));
    const dialog = await screen.findByRole("dialog");
    const create = within(dialog).getByRole("button", {
      name: "Créer le groupe",
    });
    expect(create).toBeDisabled();
    await user.type(within(dialog).getByPlaceholderText(/Travail/), "Travail");
    await user.click(create);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Travail" }),
      ).toBeInTheDocument(),
    );
    expect(
      useWorkspace.getState().groups.filter((g) => g.id !== "libre"),
    ).toHaveLength(1);
  });

  it("exports the free space to a new group", async () => {
    const user = userEvent.setup();
    await boot({ groups: [], categories: [] });
    await user.click(screen.getByRole("button", { name: /Espace libre/ }));
    expect(
      await screen.findByRole("heading", { name: "Espace libre" }),
    ).toBeInTheDocument();
    await user.keyboard("{Control>}t{/Control}");
    await screen.findByRole("region", { name: "Claude Code" });
    await user.click(screen.getByRole("button", { name: /Exporter/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: /Vers un nouveau groupe/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByPlaceholderText(/Travail/), "Projet");
    await user.click(
      within(dialog).getByRole("button", { name: "Créer le groupe" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Projet" }),
      ).toBeInTheDocument(),
    );
    const projet = useWorkspace
      .getState()
      .groups.find((g) => g.name === "Projet")!;
    expect(
      useSessions.getState().defs.filter((d) => d.groupId === projet.id),
    ).toHaveLength(1);
    expect(
      useSessions.getState().defs.filter((d) => d.groupId === "libre"),
    ).toHaveLength(0);
  });

  it("selects another group from the sidebar", async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole("treeitem", { name: /Vigie/ }));
    expect(screen.getByRole("heading", { name: "Vigie" })).toBeInTheDocument();
  });

  it("renames a group inline with F2", async () => {
    const user = userEvent.setup();
    await boot();
    const row = screen.getByRole("treeitem", { name: /Arise/ });
    row.focus();
    await user.keyboard("{F2}");
    const input = screen.getByRole("textbox", { name: "Nouveau nom" });
    await user.clear(input);
    await user.type(input, "Arise v2{Enter}");
    await waitFor(() =>
      expect(
        useWorkspace.getState().groups.find((g) => g.id === "g-arise")?.name,
      ).toBe("Arise v2"),
    );
  });

  it("filters groups in the sidebar", async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole("button", { name: "Filtrer" }));
    await user.type(
      screen.getByRole("textbox", { name: "Filtrer les groupes" }),
      "cst",
    );
    const tree = screen.getByRole("tree");
    expect(within(tree).getAllByRole("treeitem")).toHaveLength(1);
  });

  it("toggles the sidebar with Ctrl+B and opens the palette with Ctrl+K", async () => {
    const user = userEvent.setup();
    await boot();
    await user.keyboard("{Control>}b{/Control}");
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("leaves shell editing keys to a focused terminal", async () => {
    await boot();
    const term = document.createElement("div");
    term.className = "xterm";
    term.tabIndex = 0;
    document.body.appendChild(term);
    fireEvent.keyDown(term, { key: "b", ctrlKey: true });
    expect(screen.getByRole("tree")).toBeInTheDocument();
    fireEvent.keyDown(term, { key: "P", ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    term.remove();
  });

  it("jumps to pinned groups with Ctrl+2", async () => {
    const user = userEvent.setup();
    await boot();
    await user.keyboard("{Control>}2{/Control}");
    expect(screen.getByRole("heading", { name: "CStonx" })).toBeInTheDocument();
  });

  it("asks for confirmation before deleting", async () => {
    const user = userEvent.setup();
    await boot();
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /Serveurs/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: /Supprimer/ }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(useWorkspace.getState().groups.some((g) => g.id === "g-vps")).toBe(
      true,
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Supprimer le groupe" }),
    );
    await waitFor(() =>
      expect(useWorkspace.getState().groups.some((g) => g.id === "g-vps")).toBe(
        false,
      ),
    );
  });

  it("settings change the theme and persist", async () => {
    const user = userEvent.setup();
    await boot();
    useUi.getState().setView("settings");
    await screen.findByRole("heading", { name: "Paramètres" });
    await user.click(screen.getByRole("radio", { name: "Sombre" }));
    applyAppearance(useSettings.getState().settings);
    expect(document.documentElement.dataset.theme).toBe("dark");
    await useSettings.getState().load();
    expect(useSettings.getState().settings.theme).toBe("dark");
  });
});
