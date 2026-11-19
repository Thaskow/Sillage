import { mockIPC } from "@tauri-apps/api/mocks";
import type {
  Category,
  Group,
  GroupPatch,
  NewGroup,
  NewProfile,
  NewSession,
  Profile,
  SessionDef,
  Settings,
} from "./ipc";

export const defaultSettings: Settings = {
  theme: "system",
  density: "comfortable",
  motion: "system",
  sidebarVisible: true,
  sidebarWidth: 264,
  notificationsEnabled: true,
  outboundConnectionsAllowed: false,
  terminalFontSize: 13,
  scrollbackLines: 10000,
  defaultClaudeProfile: null,
  defaultCodexProfile: null,
  claudeLimitsEnabled: true,
};

export function installMockBackend(
  seed: { groups?: Group[]; categories?: Category[] } = {},
) {
  let settings = { ...defaultSettings };
  let groups: Group[] = [
    {
      id: "libre",
      name: "Espace libre",
      color: "#6c6e75",
      icon: "waves",
      categoryId: null,
      defaultProfileId: null,
      position: -1,
      pinned: false,
      archived: false,
      layout: null,
      createdAt: 0,
      updatedAt: 0,
    },
    ...(seed.groups ?? []),
  ];
  let categories: Category[] = seed.categories ? [...seed.categories] : [];
  let sessions: SessionDef[] = [];
  let profiles: Profile[] = [];
  const running = new Set<string>();
  let n = 0;
  const id = () => `mock-${++n}`;
  const find = (gid: string) => {
    const g = groups.find((x) => x.id === gid);
    if (!g) throw { kind: "not_found", message: `introuvable : groupe ${gid}` };
    return g;
  };
  const make = (g: NewGroup): Group => {
    if (!g.name.trim())
      throw {
        kind: "invalid",
        message: "valeur invalide : le nom ne peut pas être vide",
      };
    const now = Date.now();
    return {
      id: id(),
      name: g.name.trim(),
      color: g.color,
      icon: g.icon,
      categoryId: g.categoryId ?? null,
      defaultProfileId: g.defaultProfileId ?? null,
      position: groups.length,
      pinned: false,
      archived: false,
      layout: null,
      createdAt: now,
      updatedAt: now,
    };
  };

  mockIPC((cmd, raw) =>
    structuredClone(handle(cmd, (raw ?? {}) as Record<string, unknown>)),
  );

  function handle(cmd: string, a: Record<string, unknown>): unknown {
    switch (cmd) {
      case "app_info":
        return {
          version: "0.1.0-dev",
          schemaVersion: 1,
          storage: { status: "ok" },
        };
      case "get_settings":
        return settings;
      case "save_settings":
        settings = { ...(a.settings as Settings) };
        return settings;
      case "list_workspace":
        return { groups, categories };
      case "create_group": {
        const g = make(a.group as NewGroup);
        groups.push(g);
        return g;
      }
      case "update_group": {
        const g = find(a.id as string);
        Object.assign(g, a.patch as GroupPatch, { updatedAt: Date.now() });
        return { ...g };
      }
      case "delete_group":
        find(a.id as string);
        groups = groups.filter((g) => g.id !== a.id);
        return null;
      case "reorder_groups": {
        const ids = a.ids as string[];
        ids.forEach((gid, i) => (find(gid).position = i));
        groups.sort((x, y) => x.position - y.position);
        return groups;
      }
      case "duplicate_group": {
        const src = find(a.id as string);
        const g = {
          ...make({ ...src, name: `${src.name} (copie)` }),
          layout: src.layout,
        };
        groups.push(g);
        return g;
      }
      case "create_category": {
        const c = {
          id: id(),
          name: a.name as string,
          position: categories.length,
          collapsed: false,
        };
        categories.push(c);
        return c;
      }
      case "update_category": {
        const c = categories.find((x) => x.id === a.id);
        if (c && typeof a.name === "string") c.name = a.name;
        if (c && typeof a.collapsed === "boolean") c.collapsed = a.collapsed;
        return null;
      }
      case "delete_category":
        categories = categories.filter((c) => c.id !== a.id);
        groups.forEach((g) => g.categoryId === a.id && (g.categoryId = null));
        return null;
      case "available_kinds":
        return [
          {
            kind: "claude",
            label: "Claude Code",
            agent: true,
            path: "C:\claude.exe",
          },
          { kind: "codex", label: "Codex", agent: true, path: null },
          {
            kind: "powershell",
            label: "PowerShell",
            agent: false,
            path: "C:\powershell.exe",
          },
          { kind: "pwsh", label: "PowerShell 7", agent: false, path: null },
          {
            kind: "cmd",
            label: "Invite de commandes",
            agent: false,
            path: "C:\cmd.exe",
          },
          { kind: "wsl", label: "WSL", agent: false, path: null },
        ];
      case "list_sessions":
        return sessions;
      case "create_session": {
        const ns = a.session as NewSession;
        const labels: Record<string, string> = {
          claude: "Claude Code",
          powershell: "PowerShell",
          cmd: "Invite de commandes",
        };
        const kind = ns.kind ?? "powershell";
        const def: SessionDef = {
          id: id(),
          groupId: ns.groupId,
          kind,
          title: ns.title ?? labels[kind] ?? "Terminal",
          profileId: ns.profileId ?? null,
          cwd: ns.cwd ?? null,
          command: ns.command ?? null,
          args: ns.args ?? [],
          persistent: false,
          position: sessions.filter((x) => x.groupId === ns.groupId).length,
          createdAt: Date.now(),
          lastActiveAt: null,
          agentSessionId: null,
          agentStartedAt: null,
          resume: false,
        };
        sessions.push(def);
        return def;
      }
      case "rename_session": {
        const d = sessions.find((x) => x.id === a.id)!;
        d.title = a.title as string;
        return d;
      }
      case "move_session": {
        const d = sessions.find((x) => x.id === a.id)!;
        d.groupId = a.groupId as string;
        return d;
      }
      case "delete_session":
        running.delete(a.id as string);
        sessions = sessions.filter((x) => x.id !== a.id);
        return null;
      case "start_session": {
        running.add(a.id as string);
        const d = sessions.find((x) => x.id === a.id);
        if (d) d.resume = true;
        if (d?.kind === "claude" && !d.agentSessionId)
          d.agentSessionId = crypto.randomUUID();
        return { id: a.id, pid: 1234, startedAt: Date.now() };
      }
      case "reset_agent_session": {
        const d = sessions.find((x) => x.id === a.id)!;
        d.agentSessionId = null;
        d.agentStartedAt = null;
        return null;
      }
      case "write_session":
      case "resize_session":
        return null;
      case "kill_session": {
        running.delete(a.id as string);
        const d = sessions.find((x) => x.id === a.id);
        if (d) d.resume = false;
        return null;
      }
      case "list_profiles":
        return profiles;
      case "create_profile": {
        const np = a.profile as NewProfile;
        if (!np.name.trim())
          throw {
            kind: "invalid",
            message: "valeur invalide : le nom du compte est obligatoire",
          };
        const pid = id();
        const p: Profile = {
          id: pid,
          name: np.name.trim(),
          color: np.color,
          provider: np.provider,
          configDir:
            np.configDir ||
            `C:\Users\demo\AppData\Local\fr.thaskow.sillage\profiles\${pid}`,
          shareConfig: np.shareConfig ?? true,
          sharing: {
            source: np.shareConfig === false ? null : "C:\Users\demo\.claude",
            shared:
              np.shareConfig === false ? [] : ["CLAUDE.md", "settings.json"],
            failed: [],
          },
          position: profiles.length,
          createdAt: Date.now(),
          status: {
            initialized: true,
            signedIn: false,
            email: null,
            organization: null,
          },
          managed: !np.configDir,
        };
        profiles.push(p);
        return p;
      }
      case "update_profile": {
        const p = profiles.find((x) => x.id === a.id)!;
        Object.assign(p, a.patch as object);
        if (!p.shareConfig)
          p.sharing = { source: null, shared: [], failed: [] };
        return p;
      }
      case "copy_mcp_servers":
        return { added: ["github"], skipped: [] };
      case "usage_report": {
        const now = a.now as number;
        const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        const week = {
          input: 200_000,
          output: 50_000,
          cacheRead: 950_000,
          cacheWrite: 0,
        };
        return [
          {
            profileId: null,
            provider: "claude",
            configDir: "C:\Users\demo\.claude",
            usage: {
              last5h: zero,
              today: zero,
              week,
              models: [{ model: "claude-opus-5-5", tokens: week }],
              sessions: 3,
              lastActivity: now - 3_600_000,
              limits: {
                primary: {
                  usedPercent: 37,
                  windowMinutes: 300,
                  resetsAt: now + 7_200_000,
                },
                secondary: {
                  usedPercent: 8,
                  windowMinutes: 10080,
                  resetsAt: now + 172_800_000,
                },
                observedAt: now,
              },
            },
            limitsError: null,
          },
          {
            profileId: null,
            provider: "codex",
            configDir: "C:\Users\demo\.codex",
            usage: {
              last5h: zero,
              today: zero,
              week: zero,
              models: [],
              sessions: 0,
              lastActivity: null,
              limits: {
                primary: {
                  usedPercent: 42,
                  windowMinutes: 300,
                  resetsAt: now + 3_600_000,
                },
                secondary: {
                  usedPercent: 12,
                  windowMinutes: 10080,
                  resetsAt: now + 86_400_000,
                },
                observedAt: now - 600_000,
              },
            },
            limitsError: null,
          },
        ];
      }
      case "delete_profile":
        profiles = profiles.filter((x) => x.id !== a.id);
        sessions.forEach((s) => s.profileId === a.id && (s.profileId = null));
        groups.forEach(
          (g) => g.defaultProfileId === a.id && (g.defaultProfileId = null),
        );
        return null;
      case "set_session_profile": {
        const d = sessions.find((x) => x.id === a.id)!;
        d.profileId = (a.profileId as string | null) ?? null;
        return null;
      }
      case "running_sessions":
        return [...running].map((rid) => ({
          id: rid,
          pid: 1234,
          startedAt: Date.now(),
        }));
      default:
        if (cmd.startsWith("plugin:")) return null;
        throw { kind: "invalid", message: `commande inconnue ${cmd}` };
    }
  }
}
