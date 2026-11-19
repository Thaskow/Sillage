import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./design-system/tokens.css";
import { App } from "./app/App";
import { useSettings, watchAppearance } from "./features/settings/store";
import { useWorkspace } from "./features/workspace/store";
import { useSessions } from "./features/sessions/store";
import { terminals } from "./features/sessions/terminal-registry";
import { resumeSessions } from "./features/sessions/actions";
import { useProfiles } from "./features/profiles/store";
import { listen } from "@tauri-apps/api/event";
import type { ExitEvent } from "./lib/ipc";

const inTauri = "__TAURI_INTERNALS__" in window;

async function boot() {
  if (!inTauri && import.meta.env.DEV) {
    const { installMockBackend } = await import("./lib/mock-backend");
    const { demoSeed } = await import("./lib/demo-seed");
    installMockBackend(
      new URLSearchParams(location.search).has("empty") ? {} : demoSeed(),
    );
  }
  await Promise.allSettled([
    useSettings.getState().load(),
    useWorkspace.getState().load(),
    useSessions.getState().load(),
    useProfiles.getState().load(),
  ]);
  watchAppearance();
  new MutationObserver(() => terminals.retheme()).observe(
    document.documentElement,
    {
      attributes: true,
      attributeFilter: ["data-theme"],
    },
  );
  useSettings.subscribe((s, prev) => {
    if (s.settings.terminalFontSize !== prev.settings.terminalFontSize)
      terminals.retheme();
  });
  if (inTauri)
    await listen<ExitEvent>("session-exit", (e) =>
      terminals.onExit(e.payload.id, e.payload.code, e.payload.killed),
    );
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  if (inTauri) requestAnimationFrame(() => getCurrentWindow().show());
  resumeSessions();
}

boot();
