import { t } from "@/lib/i18n";
import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { ipc, type AppInfo, type Settings } from "@/lib/ipc";
import { Button, Input, Switch } from "@/design-system/primitives";
import { useUi } from "@/app/ui-store";
import { useUpdates } from "@/features/updates/store";
import { useSettings } from "./store";
import { FlagFr, FlagGb } from "./flags";
import { Monitor } from "lucide-react";

type Option<T extends string> = { value: T; label: string; icon?: ReactNode };

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
          {t("Paramètres")}
        </h1>
        <p className="mt-1 text-fg-2">
          {t(
            "Tout est enregistré localement, dans la base de Sillage sur cette machine.",
          )}
        </p>

        <Section title={t("Agents")}>
          <Row
            label={t("Comptes, réglages et consommation")}
            hint={t(
              "Comptes Claude Code et Codex, configuration partagée, compte par défaut et consommation se gèrent dans la vue Agents.",
            )}
          >
            <Button onClick={() => useUi.getState().openAgents("settings")}>
              {t("Ouvrir")}
            </Button>
          </Row>
          <Row
            label={t("Dossier par défaut")}
            hint={t(
              "Où démarrent les sessions sans dossier propre. Vide : votre dossier personnel, que Claude Code fait réautoriser à chaque lancement.",
            )}
          >
            <Input
              key={s.defaultCwd ?? ""}
              defaultValue={s.defaultCwd ?? ""}
              spellCheck={false}
              aria-label={t("Dossier par défaut")}
              placeholder="C:\Users\…\projets"
              className="w-[240px]"
              onBlur={(e) => {
                const v = e.currentTarget.value.trim() || null;
                if (v !== s.defaultCwd) void update({ defaultCwd: v });
              }}
            />
          </Row>
        </Section>

        <Section title={t("Apparence")}>
          <Row
            label={t("Langue")}
            hint={t("« Système » suit la langue de Windows.")}
          >
            <Segmented<Settings["language"]>
              value={s.language}
              onChange={(language) => update({ language })}
              options={[
                {
                  value: "system",
                  label: t("Système"),
                  icon: <Monitor size={13} aria-hidden />,
                },
                { value: "fr", label: "Français", icon: <FlagFr /> },
                { value: "en", label: "English", icon: <FlagGb /> },
              ]}
            />
          </Row>
          <Row
            label={t("Thème")}
            hint={t("« Système » suit le mode clair ou sombre de Windows.")}
          >
            <Segmented<Settings["theme"]>
              value={s.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: "system", label: t("Système") },
                { value: "light", label: t("Clair") },
                { value: "dark", label: t("Sombre") },
              ]}
            />
          </Row>
          <Row label={t("Densité")}>
            <Segmented<Settings["density"]>
              value={s.density}
              onChange={(density) => update({ density })}
              options={[
                { value: "comfortable", label: t("Confortable") },
                { value: "compact", label: t("Compacte") },
              ]}
            />
          </Row>
          <Row
            label={t("Animations")}
            hint={t(
              "« Système » respecte le réglage Windows « Effets d'animation ».",
            )}
          >
            <Segmented<Settings["motion"]>
              value={s.motion}
              onChange={(motion) => update({ motion })}
              options={[
                { value: "system", label: t("Système") },
                { value: "reduced", label: t("Réduites") },
                { value: "full", label: t("Complètes") },
              ]}
            />
          </Row>
        </Section>

        <Section title={t("Notifications")}>
          <Row
            label={t("Notifications Windows")}
            hint={t(
              "Quand un agent Claude Code attend votre validation ou a terminé et que Sillage n'est pas au premier plan. Affichées uniquement sur cette machine, sans contenu de code ni secret.",
            )}
          >
            <Switch
              checked={s.notificationsEnabled}
              onChange={(notificationsEnabled) =>
                update({ notificationsEnabled })
              }
              label={t("Notifications Windows")}
            />
          </Row>
        </Section>

        <Section title={t("Confidentialité")}>
          <Row
            label={t("Connexions sortantes de Sillage")}
            hint={t(
              "Sillage n'a ni télémétrie ni analytics et n'ouvre aucun port réseau. Il ne contacte que GitHub (recherche des mises à jour, ci-dessous) et api.anthropic.com (limites du forfait Claude, dans Agents) ; les deux se désactivent. Claude Code et Codex, lancés par vous, communiquent avec leurs services selon leur propre fonctionnement.",
            )}
          >
            <span className="text-[var(--fs-sm)] text-fg-3">
              GitHub, Anthropic
            </span>
          </Row>
        </Section>

        <UpdatesSection />

        <Section title={t("Stockage local")}>
          <Row label={t("Base de données")} hint={storageHint(info)}>
            <span className="text-fg-2 tabular-nums">
              {info ? t("Schéma v{n}", { n: info.schemaVersion }) : "—"}
            </span>
          </Row>
          <Row label={t("Version")}>
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
  if (!info) return t("Indisponible.");
  if (info.storage.status === "recovered_from_corruption")
    return t(
      "La base était illisible : elle a été mise de côté ({backup}) et une base neuve a été créée.",
      { backup: info.storage.backup },
    );
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
          aria-label={o.icon ? o.label : undefined}
          title={o.icon ? o.label : undefined}
          onClick={() => onChange(o.value)}
          className={cx(
            "transition-quick inline-flex h-[calc(var(--row-sm)-2px)] items-center justify-center rounded-[5px] px-2.5 text-[var(--fs-sm)]",
            value === o.value
              ? "bg-raised font-medium text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
              : "text-fg-2 hover:text-fg [&>svg]:opacity-60 hover:[&>svg]:opacity-100",
          )}
        >
          {o.icon ?? o.label}
        </button>
      ))}
    </div>
  );
}

function UpdatesSection() {
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  const u = useUpdates();
  const status =
    u.status === "checking"
      ? t("Recherche…")
      : u.status === "uptodate"
        ? t("Sillage est à jour.")
        : u.status === "available"
          ? t("Version {version} disponible.", { version: u.version ?? "" })
          : u.status === "downloading" || u.status === "installing"
            ? t("Installation en cours…")
            : u.status === "error"
              ? t("Recherche impossible : {error}", { error: u.error ?? "" })
              : t("Pas encore recherché.");
  return (
    <Section title={t("Mises à jour")}>
      <Row
        label={t("Rechercher automatiquement")}
        hint={t(
          "Au démarrage puis toutes les 6 heures, Sillage lit la dernière version publiée sur github.com/Thaskow/sillage. Rien n'est installé sans votre accord.",
        )}
      >
        <Switch
          checked={s.autoUpdateCheck}
          onChange={(autoUpdateCheck) => update({ autoUpdateCheck })}
          label={t("Rechercher automatiquement les mises à jour")}
        />
      </Row>
      <Row label={t("Version installée")} hint={status}>
        {u.status === "available" ? (
          <Button variant="primary" onClick={() => u.setDialogOpen(true)}>
            {t("Mettre à jour")}
          </Button>
        ) : (
          <Button
            disabled={u.status === "checking"}
            onClick={() => void u.check()}
          >
            {t("Rechercher maintenant")}
          </Button>
        )}
      </Row>
    </Section>
  );
}
