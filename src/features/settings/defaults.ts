import type { Settings } from "@/lib/ipc";

export const defaultSettings: Settings = {
  language: "system",
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
  autoUpdateCheck: true,
  defaultCwd: null,
};
