import type { Provider } from "@/lib/ipc";
import { Switch } from "@/design-system/primitives";
import { useSessions } from "@/features/sessions/store";
import { kindIcon } from "@/features/sessions/visuals";
import { useSettings } from "@/features/settings/store";
import { AccountsSection } from "@/features/profiles/AccountsSection";
import { providerLabel, useProfiles } from "@/features/profiles/store";

const key = {
  claude: "defaultClaudeProfile",
  codex: "defaultCodexProfile",
} as const;

export function AgentSettings() {
  const kinds = useSessions((s) => s.kinds);
  const profiles = useProfiles((s) => s.profiles);
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);

  return (
    <div>
      <div className="divide-y divide-line rounded-lg border border-line bg-surface">
        {(["claude", "codex"] as Provider[]).map((p) => {
          const Icon = kindIcon[p];
          const path = kinds.find((k) => k.kind === p)?.path;
          const accounts = profiles.filter((x) => x.provider === p);
          const current = settings[key[p]];
          return (
            <div key={p} className="flex items-center gap-3 px-4 py-3">
              <span className="flex size-8 items-center justify-center rounded-md border border-line bg-raised">
                <Icon size={16} className="text-fg" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{providerLabel[p]}</div>
                <div
                  className="truncate font-mono text-[11px] text-fg-3"
                  title={path ?? undefined}
                >
                  {path ?? "Introuvable : installez-le ou ajoutez-le au PATH"}
                </div>
              </div>
              <label className="flex items-center gap-2 text-[var(--fs-sm)] text-fg-2">
                Compte par défaut
                <select
                  value={
                    accounts.some((a) => a.id === current)
                      ? (current ?? "")
                      : ""
                  }
                  onChange={(e) => update({ [key[p]]: e.target.value || null })}
                  className="h-[var(--row)] rounded-md border border-line-strong bg-raised px-2 text-fg outline-none focus:border-accent"
                >
                  <option value="">Compte habituel</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          );
        })}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              Relever les limites du forfait Claude
            </div>
            <div className="text-[var(--fs-sm)] text-fg-3">
              Lit le jeton de connexion de chaque compte Claude uniquement pour
              interroger api.anthropic.com (jauges 5 h et semaine, comme
              /usage). Le jeton n'est ni affiché, ni copié, ni envoyé ailleurs.
            </div>
          </div>
          <Switch
            checked={settings.claudeLimitsEnabled}
            onChange={(claudeLimitsEnabled) => update({ claudeLimitsEnabled })}
            label="Relever les limites du forfait Claude"
          />
        </div>
        <p className="px-4 py-2.5 text-[var(--fs-sm)] text-fg-3">
          Le compte par défaut d'un groupe (dans ses réglages) passe avant
          celui-ci. Le menu Agent permet toujours de choisir un autre compte.
        </p>
      </div>
      <AccountsSection />
    </div>
  );
}
