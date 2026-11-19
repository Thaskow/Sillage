import { useEffect, useRef, useState } from "react";
import * as RTooltip from "@radix-ui/react-tooltip";
import { TitleBar } from "./shell/TitleBar";
import { useUi } from "./ui-store";
import { useHotkeys } from "./hotkeys";
import { Sidebar } from "@/features/workspace/Sidebar";
import { WorkspaceView } from "@/features/workspace/WorkspaceView";
import { GroupDialog } from "@/features/workspace/GroupDialog";
import { UpdateDialog } from "@/features/updates/UpdateDialog";
import { SettingsView } from "@/features/settings/SettingsView";
import { HistoryView } from "@/features/placeholders";
import { ActivityView } from "@/features/activity/ActivityView";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { useSettings } from "@/features/settings/store";
import { Toaster } from "@/design-system/toast";
import { ConfirmHost } from "@/design-system/confirm";
import { AgentsView } from "@/features/agents/AgentsView";

export function App() {
  useHotkeys();
  const view = useUi((s) => s.view);
  const sidebarVisible = useSettings((s) => s.settings.sidebarVisible);
  const savedWidth = useSettings((s) => s.settings.sidebarWidth);

  return (
    <RTooltip.Provider delayDuration={350} skipDelayDuration={150}>
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          {sidebarVisible && <ResizableSidebar width={savedWidth} />}
          <main className="min-w-0 flex-1 bg-bg">
            {view === "workspace" && <WorkspaceView />}
            {view === "agents" && <AgentsView />}
            {view === "activity" && <ActivityView />}
            {view === "history" && <HistoryView />}
            {view === "settings" && <SettingsView />}
          </main>
        </div>
      </div>
      <GroupDialog />
      <UpdateDialog />
      <CommandPalette />
      <ConfirmHost />
      <Toaster />
    </RTooltip.Provider>
  );
}

function ResizableSidebar({ width }: { width: number }) {
  const [live, setLive] = useState(width);
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => setLive(width), [width]);

  return (
    <div className="relative flex shrink-0">
      <Sidebar width={live} />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Largeur de la barre latérale"
        aria-valuenow={live}
        aria-valuemin={200}
        aria-valuemax={420}
        tabIndex={0}
        onKeyDown={(e) => {
          const d =
            e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
          if (!d) return;
          const w = Math.min(420, Math.max(200, live + d));
          setLive(w);
          useSettings.getState().update({ sidebarWidth: w });
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, w: live };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setLive(
            Math.min(
              420,
              Math.max(200, drag.current.w + e.clientX - drag.current.x),
            ),
          );
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          drag.current = null;
          useSettings.getState().update({ sidebarWidth: live });
        }}
        className="transition-quick absolute top-0 -right-[3px] z-10 h-full w-[6px] cursor-col-resize hover:bg-accent-soft focus-visible:bg-accent-soft"
      />
    </div>
  );
}
