import { Channel, invoke } from "@tauri-apps/api/core";
import { translateError } from "@/lib/i18n";

export type Theme = "system" | "light" | "dark";
export type Density = "compact" | "comfortable";
export type Motion = "system" | "reduced" | "full";
export type Language = "system" | "fr" | "en";

export interface Settings {
  language: Language;
  theme: Theme;
  density: Density;
  motion: Motion;
  sidebarVisible: boolean;
  sidebarWidth: number;
  notificationsEnabled: boolean;
  outboundConnectionsAllowed: boolean;
  terminalFontSize: number;
  scrollbackLines: number;
  defaultClaudeProfile: string | null;
  defaultCodexProfile: string | null;
  claudeLimitsEnabled: boolean;
  autoUpdateCheck: boolean;
  defaultCwd: string | null;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  icon: string;
  categoryId: string | null;
  defaultProfileId: string | null;
  position: number;
  pinned: boolean;
  archived: boolean;
  layout: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  position: number;
  collapsed: boolean;
}

export interface NewGroup {
  name: string;
  color: string;
  icon: string;
  categoryId?: string | null;
  defaultProfileId?: string | null;
}

export type GroupPatch = Partial<
  Pick<
    Group,
    | "name"
    | "color"
    | "icon"
    | "categoryId"
    | "defaultProfileId"
    | "pinned"
    | "archived"
    | "layout"
  >
>;

export type StorageOutcome =
  | { status: "ok" }
  | { status: "created" }
  | { status: "recovered_from_corruption"; backup: string };

export interface AppInfo {
  version: string;
  schemaVersion: number;
  storage: StorageOutcome;
}

export interface IpcError {
  kind: string;
  message: string;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e)
    return translateError(String((e as IpcError).message));
  return translateError(String(e));
}

export const ipc = {
  appInfo: () => invoke<AppInfo>("app_info"),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) =>
    invoke<Settings>("save_settings", { settings }),
  listWorkspace: () =>
    invoke<{ groups: Group[]; categories: Category[] }>("list_workspace"),
  createGroup: (group: NewGroup) => invoke<Group>("create_group", { group }),
  updateGroup: (id: string, patch: GroupPatch) =>
    invoke<Group>("update_group", { id, patch }),
  deleteGroup: (id: string) => invoke<void>("delete_group", { id }),
  reorderGroups: (ids: string[]) => invoke<Group[]>("reorder_groups", { ids }),
  duplicateGroup: (id: string) => invoke<Group>("duplicate_group", { id }),
  createCategory: (name: string) =>
    invoke<Category>("create_category", { name }),
  updateCategory: (id: string, name?: string, collapsed?: boolean) =>
    invoke<void>("update_category", { id, name, collapsed }),
  deleteCategory: (id: string) => invoke<void>("delete_category", { id }),
};

export type Ipc = typeof ipc;

export type SessionKind =
  "claude" | "codex" | "powershell" | "pwsh" | "cmd" | "wsl" | "custom";

export interface SessionDef {
  id: string;
  groupId: string;
  kind: SessionKind;
  title: string;
  profileId: string | null;
  cwd: string | null;
  command: string | null;
  args: string[];
  persistent: boolean;
  position: number;
  createdAt: number;
  lastActiveAt: number | null;
  agentSessionId: string | null;
  agentStartedAt: number | null;
  resume: boolean;
}

export interface NewSession {
  groupId: string;
  kind?: SessionKind;
  title?: string;
  profileId?: string | null;
  cwd?: string | null;
  command?: string | null;
  args?: string[];
}

export interface KindInfo {
  kind: SessionKind;
  label: string;
  agent: boolean;
  path: string | null;
}

export interface RunningInfo {
  id: string;
  pid: number | null;
  startedAt: number;
}

export interface ExitEvent {
  id: string;
  code: number | null;
  killed: boolean;
}

export const sessionsIpc = {
  availableKinds: () => invoke<KindInfo[]>("available_kinds"),
  list: () => invoke<SessionDef[]>("list_sessions"),
  resetAgent: (id: string) => invoke<void>("reset_agent_session", { id }),
  create: (session: NewSession) =>
    invoke<SessionDef>("create_session", { session }),
  rename: (id: string, title: string) =>
    invoke<SessionDef>("rename_session", { id, title }),
  setCwd: (id: string, cwd: string | null) =>
    invoke<SessionDef>("set_session_cwd", { id, cwd }),
  move: (id: string, groupId: string) =>
    invoke<SessionDef>("move_session", { id, groupId }),
  remove: (id: string) => invoke<void>("delete_session", { id }),
  start: (
    id: string,
    cols: number,
    rows: number,
    output: Channel<ArrayBuffer>,
  ) => invoke<RunningInfo>("start_session", { id, cols, rows, output }),
  write: (id: string, data: string) =>
    invoke<void>("write_session", { id, data }),
  resize: (id: string, cols: number, rows: number) =>
    invoke<void>("resize_session", { id, cols, rows }),
  kill: (id: string) => invoke<void>("kill_session", { id }),
  running: () => invoke<RunningInfo[]>("running_sessions"),
  setProfile: (id: string, profileId: string | null) =>
    invoke<void>("set_session_profile", { id, profileId }),
};

export type Provider = "claude" | "codex";

export interface AccountStatus {
  initialized: boolean;
  signedIn: boolean;
  email: string | null;
  organization: string | null;
}

export interface Profile {
  id: string;
  name: string;
  color: string;
  provider: Provider;
  configDir: string;
  shareConfig: boolean;
  position: number;
  createdAt: number;
  status: AccountStatus;
  sharing: Sharing;
  managed: boolean;
}

export interface Sharing {
  source: string | null;
  shared: string[];
  failed: string[];
}

export interface ProfilePatch {
  name?: string;
  color?: string;
  shareConfig?: boolean;
}

export interface NewProfile {
  name: string;
  color: string;
  provider: Provider;
  configDir?: string | null;
  shareConfig?: boolean;
}

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface LimitWindow {
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: number | null;
}

export interface Usage {
  last5h: Tokens;
  today: Tokens;
  week: Tokens;
  models: { model: string; tokens: Tokens }[];
  sessions: number;
  lastActivity: number | null;
  limits: {
    primary: LimitWindow | null;
    secondary: LimitWindow | null;
    observedAt: number;
  } | null;
}

export interface AccountUsage {
  profileId: string | null;
  provider: Provider;
  configDir: string;
  usage: Usage;
  limitsError: string | null;
}

export const profilesIpc = {
  list: () => invoke<Profile[]>("list_profiles"),
  create: (profile: NewProfile) =>
    invoke<Profile>("create_profile", { profile }),
  update: (id: string, patch: ProfilePatch) =>
    invoke<Profile>("update_profile", { id, patch }),
  remove: (id: string, removeFiles: boolean) =>
    invoke<void>("delete_profile", { id, removeFiles }),
  copyMcp: (id: string) =>
    invoke<{ added: string[]; skipped: string[] }>("copy_mcp_servers", { id }),
  usage: (now: number, dayStart: number) =>
    invoke<AccountUsage[]>("usage_report", { now, dayStart }),
};
