import { cx } from "@/lib/cx";
import { useUi, type AgentsTab } from "@/app/ui-store";
import { UsagePanel } from "./UsagePanel";
import { AgentSettings } from "./AgentSettings";

const tabs: [AgentsTab, string][] = [
  ["usage", "Consommation"],
  ["settings", "Comptes et réglages"],
];

export function AgentsView() {
  const tab = useUi((s) => s.agentsTab);
  const openAgents = useUi((s) => s.openAgents);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[920px] px-8 py-8">
        <h1 className="text-[18px] font-semibold tracking-[-0.015em]">
          Agents
        </h1>
        <div
          role="tablist"
          aria-label="Agents"
          className="mt-4 mb-6 flex gap-1 border-b border-line"
        >
          {tabs.map(([v, l]) => (
            <button
              key={v}
              role="tab"
              aria-selected={tab === v}
              onClick={() => openAgents(v)}
              className={cx(
                "transition-quick -mb-px border-b-2 px-3 pb-2 text-[var(--fs-sm)]",
                tab === v
                  ? "border-accent font-medium text-fg"
                  : "border-transparent text-fg-2 hover:text-fg",
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          {tab === "usage" && <UsagePanel />}
          {tab === "settings" && <AgentSettings />}
        </div>
      </div>
    </div>
  );
}
