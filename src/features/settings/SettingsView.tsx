import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { ipc, type AppInfo, type Settings } from "@/lib/ipc";
import { Button, Switch } from "@/design-system/primitives";
import { useUi } from "@/app/ui-store";
import { useSettings } from "./store";

type Option<T extends string> = { value: T; label: string };

export function SettingsView() {
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    ipc.appInfo().then(setInfo, () => setInfo(null));
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[680px] px-8 py-8">
        <h1 className="text-[18px] font-semibold tracking-[-0.015em]">
          Paramètres
        </h1>
        <p className="mt-1 text-fg-2">
          Tout est enregistré localement, dans la base de Sillage sur cette
          machine.
        </p>

        <Section title="Agents">
          <Row
            label="Comptes, réglages et consommation"
            hint="Comptes Claude Code et Codex, configuration partagée, compte par défaut et consommation se gèrent dans la vue Agents."
          >
            <Button onClick={() => useUi.getState().openAgents("settings")}>
              Ouvrir
            </Button>
          </Row>
        </Section>

        <Section title="Apparence">
          <Row
            label="Thème"
            hint="« Système » suit le mode clair ou sombre de Windows."
          >
            <Segmented<Settings["theme"]>
              value={s.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: "system", label: "Système" },
                { value: "light", label: "Clair" },
                { value: "dark", label: "Sombre" },
              ]}
            />
          </Row>
          <Row label="Densité">
            <Segmented<Settings["density"]>
              value={s.density}
              onChange={(density) => update({ density })}
              options={[
                { value: "comfortable", label: "Confortable" },
                { value: "compact", label: "Compacte" },
              ]}
            />
          </Row>
          <Row
            label="Animations"
            hint="« Système » respecte le réglage Windows « Effets d'animation »."
          >
            <Segmented<Settings["motion"]>
              value={s.motion}
              onChange={(motion) => update({ motion })}
              options={[
                { value: "system", label: "Système" },
                { value: "reduced", label: "Réduites" },
                { value: "full", label: "Complètes" },
              ]}
            />
          </Row>
        </Section>

        <Section title="Notifications">
          <Row
            label="Notifications Windows"
            hint="Affichées uniquement sur cette machine, sans contenu de code ni secret."
          >
            <Switch
              checked={s.notificationsEnabled}
              onChange={(notificationsEnabled) =>
                update({ notificationsEnabled })
              }
              label="Notifications Windows"
            />
          </Row>
        </Section>

        <Section title="Confidentialité">
          <Row
            label="Connexions sortantes de Sillage"
            hint="Désactivées par défaut. Sillage n'a ni télémétrie, ni analytics, ni mise à jour automatique, et n'ouvre aucun port réseau. Seule exception : le relevé des limites du forfait Claude auprès d'api.anthropic.com, désactivable dans Agents. Claude Code, lancé par vous, communique avec Anthropic selon son propre fonctionnement."
          >
            <Switch
              checked={s.outboundConnectionsAllowed}
              onChange={(outboundConnectionsAllowed) =>
                update({ outboundConnectionsAllowed })
              }
              label="Autoriser les connexions sortantes"
            />
          </Row>
        </Section>

        <Section title="Stockage local">
          <Row label="Base de données" hint={storageHint(info)}>
            <span className="text-fg-2 tabular-nums">
              {info ? `Schéma v${info.schemaVersion}` : "—"}
            </span>
          </Row>
          <Row label="Version">
            <span className="text-fg-2 tabular-nums">
              {info?.version ?? "—"}
            </span>
          </Row>
        </Section>
      </div>
    </div>
  );
}

function storageHint(info: AppInfo | null): string {
  if (!info) return "Indisponible.";
  if (info.storage.status === "recovered_from_corruption")
    return `La base était illisible : elle a été mise de côté (${info.storage.backup}) et une base neuve a été créée.`;
  return "%LOCALAPPDATA%\\fr.thaskow.sillage\\sillage.db";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-1 text-[11px] font-medium tracking-[0.05em] text-fg-3 uppercase">
        {title}
      </h2>
      <div className="divide-y divide-line rounded-lg border border-line bg-surface">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-6 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{label}</div>
        {hint && (
          <div className="mt-0.5 text-[var(--fs-sm)] text-fg-3">{hint}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      className="flex rounded-md border border-line bg-sunken p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "transition-quick h-[calc(var(--row-sm)-2px)] rounded-[5px] px-2.5 text-[var(--fs-sm)]",
            value === o.value
              ? "bg-raised font-medium text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
              : "text-fg-2 hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
