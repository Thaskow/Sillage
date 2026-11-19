import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Channel } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { errorMessage, sessionsIpc } from "@/lib/ipc";
import { useSettings } from "@/features/settings/store";
import { askConfirm } from "@/design-system/confirm";
import { isReservedCombo } from "@/app/hotkeys";
import { useSessions } from "./store";

interface Host {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  el: HTMLDivElement;
  opened: boolean;
  observer: ResizeObserver | null;
  resizeTimer: number | undefined;
}

const hosts = new Map<string, Host>();

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function themeFromTokens(): ITheme {
  const dark = document.documentElement.dataset.theme === "dark";
  return {
    background: cssVar("--terminal-bg"),
    foreground: cssVar("--text"),
    cursor: cssVar("--accent"),
    cursorAccent: cssVar("--terminal-bg"),
    selectionBackground: dark
      ? "rgba(116,184,173,0.28)"
      : "rgba(44,107,99,0.2)",
    black: dark ? "#2a2b30" : "#1e2023",
    red: dark ? "#e4756c" : "#b8433b",
    green: dark ? "#7cc58f" : "#3a8150",
    yellow: dark ? "#e2b45c" : "#a8741a",
    blue: dark ? "#7ea6e0" : "#3863a6",
    magenta: dark ? "#c39be0" : "#8c4fa8",
    cyan: dark ? "#74b8ad" : "#2c7f78",
    white: dark ? "#d7d6d2" : "#c9c7c1",
    brightBlack: dark ? "#6c6e75" : "#6c6e73",
    brightRed: dark ? "#f0918a" : "#d0574e",
    brightGreen: dark ? "#9bd6aa" : "#4c9b64",
    brightYellow: dark ? "#efc77a" : "#c28a2c",
    brightBlue: dark ? "#9cbcec" : "#4d7ac0",
    brightMagenta: dark ? "#d4b5ea" : "#a464c2",
    brightCyan: dark ? "#95cbc2" : "#3a958d",
    brightWhite: dark ? "#f2f1ed" : "#ffffff",
  };
}

function create(id: string): Host {
  const s = useSettings.getState().settings;
  const term = new Terminal({
    allowProposedApi: true,
    fontFamily:
      '"JetBrains Mono Variable", "Cascadia Mono", Consolas, monospace',
    fontSize: s.terminalFontSize,
    lineHeight: 1.2,
    scrollback: s.scrollbackLines,
    cursorBlink: true,
    cursorStyle: "bar",
    macOptionIsMeta: false,
    rightClickSelectsWord: false,
    theme: themeFromTokens(),
    windowsPty: { backend: "conpty" },
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  const unicode = new Unicode11Addon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(unicode);
  term.unicode.activeVersion = "11";
  term.loadAddon(
    new WebLinksAddon(async (_e, uri) => {
      if (!/^https?:\/\//i.test(uri)) return;
      const ok = await askConfirm({
        title: "Ouvrir ce lien ?",
        description: uri,
        confirmLabel: "Ouvrir dans le navigateur",
      });
      if (ok) openUrl(uri).catch(() => {});
    }),
  );

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    if (isReservedCombo(e)) return false;
    const key = e.key.toLowerCase();
    if (e.ctrlKey && key === "c" && (e.shiftKey || term.hasSelection())) {
      const text = term.getSelection();
      if (text) writeText(text).catch(() => {});
      term.clearSelection();
      return false;
    }
    if (e.ctrlKey && key === "v") {
      readText()
        .then((t) => t && term.paste(t))
        .catch(() => {});
      return false;
    }
    return true;
  });

  term.onData((data) => {
    if (useSessions.getState().runtime[id]?.state !== "running") return;
    sessionsIpc.write(id, data).catch(() => {});
  });
  term.onResize(({ cols, rows }) => {
    if (useSessions.getState().runtime[id]?.state !== "running") return;
    sessionsIpc.resize(id, cols, rows).catch(() => {});
  });

  const el = document.createElement("div");
  el.className = "h-full w-full";
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (term.hasSelection()) {
      writeText(term.getSelection()).catch(() => {});
      term.clearSelection();
    } else {
      readText()
        .then((t) => t && term.paste(t))
        .catch(() => {});
    }
  });
  const host: Host = {
    term,
    fit,
    search,
    el,
    opened: false,
    observer: null,
    resizeTimer: undefined,
  };
  hosts.set(id, host);
  return host;
}

function host(id: string): Host {
  return hosts.get(id) ?? create(id);
}

const CONTROL =
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|[\x00-\x20\x7f]/g;

function hasVisibleText(chunk: string): boolean {
  return chunk.replace(CONTROL, "").length > 0;
}

function safeFit(h: Host) {
  if (!h.el.isConnected || h.el.clientWidth < 20 || h.el.clientHeight < 20)
    return;
  try {
    h.fit.fit();
  } catch {
    return;
  }
}

export const terminals = {
  attach(id: string, container: HTMLElement) {
    const h = host(id);
    container.appendChild(h.el);
    if (!h.opened) {
      h.term.open(h.el);
      h.opened = true;
    }
    h.observer?.disconnect();
    h.observer = new ResizeObserver(() => {
      window.clearTimeout(h.resizeTimer);
      h.resizeTimer = window.setTimeout(() => safeFit(h), 40);
    });
    h.observer.observe(container);
    requestAnimationFrame(() => {
      safeFit(h);
      h.term.refresh(0, h.term.rows - 1);
    });
  },

  detach(id: string) {
    const h = hosts.get(id);
    if (!h) return;
    h.observer?.disconnect();
    h.observer = null;
    h.el.remove();
  },

  focus(id: string) {
    hosts.get(id)?.term.focus();
  },

  search(id: string, query: string, backwards = false) {
    const h = hosts.get(id);
    if (!h || !query) return false;
    return backwards ? h.search.findPrevious(query) : h.search.findNext(query);
  },

  clearSearch(id: string) {
    hosts.get(id)?.search.clearDecorations();
  },

  async start(id: string) {
    const { runtime, setRuntime } = useSessions.getState();
    const st = runtime[id]?.state;
    if (st === "running" || st === "starting") return;
    const h = host(id);
    safeFit(h);
    setRuntime(id, { state: "starting" });
    if (st === "exited" || st === "error") h.term.write("\r\n");
    const channel = new Channel<ArrayBuffer>();
    const { setOpening } = useSessions.getState();
    setOpening(id, true);
    let opening = true;
    const decoder = new TextDecoder();
    channel.onmessage = (buf) => {
      const bytes = new Uint8Array(buf);
      h.term.write(bytes);
      if (opening && hasVisibleText(decoder.decode(bytes, { stream: true }))) {
        opening = false;
        setOpening(id, false);
      }
    };
    try {
      const cols = h.term.cols;
      const rows = h.term.rows;
      const info = await sessionsIpc.start(id, cols, rows, channel);
      setRuntime(id, { state: "running", startedAt: info.startedAt });
      safeFit(h);
      if (h.term.cols !== cols || h.term.rows !== rows) {
        sessionsIpc.resize(id, h.term.cols, h.term.rows).catch(() => {});
      }
    } catch (e) {
      const msg = errorMessage(e);
      setRuntime(id, { state: "error", error: msg, endedAt: Date.now() });
      h.term.write(`\r\n\x1b[31m${msg}\x1b[0m\r\n`);
    }
  },

  onExit(id: string, code: number | null, killed: boolean) {
    const h = hosts.get(id);
    const label = killed ? "arrêté" : `terminé (code ${code ?? "?"})`;
    h?.term.write(`\r\n\x1b[2m— processus ${label} —\x1b[0m\r\n`);
    useSessions.getState().setRuntime(id, {
      state: "exited",
      exitCode: code,
      killed,
      endedAt: Date.now(),
    });
  },

  dispose(id: string) {
    const h = hosts.get(id);
    if (!h) return;
    h.observer?.disconnect();
    h.term.dispose();
    h.el.remove();
    hosts.delete(id);
  },

  retheme() {
    const theme = themeFromTokens();
    const s = useSettings.getState().settings;
    for (const h of hosts.values()) {
      h.term.options.theme = theme;
      h.term.options.fontSize = s.terminalFontSize;
    }
  },

  refitAll() {
    for (const h of hosts.values()) {
      const family = h.term.options.fontFamily;
      h.term.options.fontFamily = `${family} `;
      h.term.options.fontFamily = family;
      safeFit(h);
    }
  },
};

if (typeof document !== "undefined" && document.fonts) {
  Promise.all([
    document.fonts.load('13px "JetBrains Mono Variable"'),
    document.fonts.load('bold 13px "JetBrains Mono Variable"'),
  ])
    .then(() => document.fonts.ready)
    .then(() => terminals.refitAll())
    .catch(() => {});
  document.fonts.addEventListener?.("loadingdone", () => terminals.refitAll());
}
