import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { cx } from "@/lib/cx";
import {
  errorMessage,
  profilesIpc,
  type AccountUsage,
  type LimitWindow,
  type Tokens,
} from "@/lib/ipc";
import { Button } from "@/design-system/primitives";
import { AccountAvatar } from "@/features/profiles/ProfileBadge";
import { providerLabel, useProfiles } from "@/features/profiles/store";
import { useSettings } from "@/features/settings/store";

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${nf.format(n / 1_000)} k`;
  if (n < 1_000_000_000) return `${nf.format(n / 1_000_000)} M`;
  return `${nf.format(n / 1_000_000_000)} Md`;
}

const total = (t: Tokens) => t.input + t.output + t.cacheRead + t.cacheWrite;

function ago(ms: number, now: number): string {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

function inTime(ms: number, now: number): string {
  const m = Math.max(0, Math.round((ms - now) / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)} j`;
}

function windowLabel(w: LimitWindow, fallback: string): string {
  const m = w.windowMinutes;
  if (!m) return fallback;
  if (m % 1440 === 0) return m === 10080 ? "Semaine" : `${m / 1440} jours`;
  if (m % 60 === 0) return `Fenêtre ${m / 60} h`;
  return `Fenêtre ${m} min`;
}

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function UsagePanel() {
  const [data, setData] = useState<AccountUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setBusy(true);
    const t = Date.now();
    try {
      setData(await profilesIpc.usage(t, startOfDay(t)));
      setError(null);
      setNow(t);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 5 * 60_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  return (
    <div>
      <div className="flex items-start gap-4">
        <p className="flex-1 text-[var(--fs-sm)] text-fg-3">
          Calculé sur cette machine à partir de l'historique que Claude Code et
          Codex écrivent dans le dossier de chaque compte (7 derniers jours).
          Sillage n'en lit que les compteurs de jetons ; rien n'est envoyé.
        </p>
        <Button onClick={() => void refresh()} disabled={busy}>
          {busy ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          Actualiser
        </Button>
      </div>
      {error && <p className="mt-4 text-err">{error}</p>}
      {!data && !error && (
        <p className="mt-6 flex items-center gap-2 text-fg-3">
          <Loader2 size={14} className="animate-spin" /> Lecture de
          l'historique…
        </p>
      )}
      {data && !data.length && (
        <p className="mt-6 text-fg-3">
          Aucun dossier Claude Code ou Codex trouvé sur cette machine.
        </p>
      )}
      <div className="mt-4 flex flex-col gap-4">
        {data?.map((a) => (
          <UsageCard key={a.configDir} account={a} now={now} />
        ))}
      </div>
    </div>
  );
}

function NoLimits({ account }: { account: AccountUsage }) {
  const enabled = useSettings((s) => s.settings.claudeLimitsEnabled);
  if (account.provider === "codex")
    return (
      <p className="text-[var(--fs-sm)] text-fg-3 sm:col-span-2">
        Limites du forfait : Codex ne les a pas encore relevées pour ce compte.
      </p>
    );
  if (!enabled)
    return (
      <p className="text-[var(--fs-sm)] text-fg-3 sm:col-span-2">
        Limites du forfait : relevé désactivé dans Comptes et réglages.
      </p>
    );

  return (
    <p
      className={cx(
        "text-[var(--fs-sm)] sm:col-span-2",
        account.limitsError ? "text-wait" : "text-fg-3",
      )}
    >
      Limites du forfait :{" "}
      {account.limitsError ??
        "Anthropic n'a renvoyé aucune limite pour ce compte"}
      .
    </p>
  );
}

function UsageCard({ account, now }: { account: AccountUsage; now: number }) {
  const profile = useProfiles((s) =>
    s.profiles.find((p) => p.id === account.profileId),
  );
  const u = account.usage;
  const week = total(u.week);
  const top = u.models[0] ? total(u.models[0].tokens) : 0;
  return (
    <section
      aria-label={`Consommation ${profile?.name ?? "compte habituel"} ${providerLabel[account.provider]}`}
      className="rounded-lg border border-line bg-surface"
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <AccountAvatar provider={account.provider} profile={profile} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">
              {profile?.name ?? "Compte habituel"}
            </span>
            <span className="rounded-[4px] bg-sunken px-1.5 text-[10.5px] leading-[18px] text-fg-3">
              {providerLabel[account.provider]}
            </span>
          </div>
          <div className="truncate text-[var(--fs-sm)] text-fg-3">
            {profile?.status.email ?? account.configDir}
          </div>
        </div>
        <div className="text-right text-[var(--fs-sm)] text-fg-3">
          <div>
            {u.sessions} session{u.sessions > 1 ? "s" : ""} sur 7 jours
          </div>
          <div>
            {u.lastActivity
              ? `Dernière activité ${ago(u.lastActivity, now)}`
              : "Aucune activité récente"}
          </div>
        </div>
      </header>

      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        {u.limits && (u.limits.primary || u.limits.secondary) ? (
          <>
            {u.limits.primary && (
              <Gauge
                label={windowLabel(u.limits.primary, "Fenêtre courte")}
                w={u.limits.primary}
                now={now}
              />
            )}
            {u.limits.secondary && (
              <Gauge
                label={windowLabel(u.limits.secondary, "Fenêtre longue")}
                w={u.limits.secondary}
                now={now}
              />
            )}
            <p className="text-[11px] text-fg-3 sm:col-span-2">
              Limites du forfait relevées{" "}
              {account.provider === "claude"
                ? "auprès d'Anthropic"
                : "par Codex"}{" "}
              {ago(u.limits.observedAt, now)}.
            </p>
          </>
        ) : (
          <NoLimits account={account} />
        )}
      </div>

      <div className="grid grid-cols-3 border-t border-line">
        {(
          [
            ["5 dernières heures", u.last5h],
            ["Aujourd'hui", u.today],
            ["7 jours", u.week],
          ] as const
        ).map(([label, t], i) => (
          <div
            key={label}
            className={cx("px-4 py-3", i > 0 && "border-l border-line")}
          >
            <div className="text-[11px] tracking-[0.04em] text-fg-3 uppercase">
              {label}
            </div>
            <div className="mt-0.5 text-[18px] font-semibold tabular-nums">
              {formatTokens(total(t))}
            </div>
            <div className="text-[11px] text-fg-3 tabular-nums">
              entrée {formatTokens(t.input)} · sortie {formatTokens(t.output)}
              {t.cacheRead + t.cacheWrite > 0 &&
                ` · cache ${formatTokens(t.cacheRead + t.cacheWrite)}`}
            </div>
          </div>
        ))}
      </div>

      {u.models.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-line px-4 py-3">
          {u.models.slice(0, 5).map((m) => {
            const v = total(m.tokens);
            return (
              <li
                key={m.model}
                className="flex items-center gap-3 text-[var(--fs-sm)]"
              >
                <span className="w-44 truncate font-mono text-[11.5px] text-fg-2">
                  {m.model}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                  <span
                    className="block h-full rounded-full bg-accent/70"
                    style={{ width: `${top ? (v / top) * 100 : 0}%` }}
                  />
                </span>
                <span className="w-24 text-right text-fg-3 tabular-nums">
                  {formatTokens(v)}
                  {week ? ` · ${Math.round((v / week) * 100)} %` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Gauge({
  label,
  w,
  now,
}: {
  label: string;
  w: LimitWindow;
  now: number;
}) {
  const reset = w.resetsAt !== null && w.resetsAt <= now;
  const pct = Math.min(100, Math.max(0, w.usedPercent));
  return (
    <div>
      <div className="flex items-baseline justify-between text-[var(--fs-sm)]">
        <span className="font-medium">{label}</span>
        <span className="text-fg-2 tabular-nums">
          {reset ? "—" : `${Math.round(pct)} %`}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={reset ? 0 : Math.round(pct)}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken"
      >
        <div
          className={cx(
            "h-full rounded-full",
            reset
              ? "bg-line-strong"
              : pct >= 90
                ? "bg-err"
                : pct >= 70
                  ? "bg-wait"
                  : "bg-accent",
          )}
          style={{ width: `${reset ? 0 : pct}%` }}
        />
      </div>
      <div className="mt-1 text-[11px] text-fg-3">
        {w.resetsAt === null
          ? "Réinitialisation : inconnue"
          : reset
            ? "Fenêtre réinitialisée depuis le relevé"
            : `Réinitialisation dans ${inTime(w.resetsAt, now)}`}
      </div>
    </div>
  );
}
