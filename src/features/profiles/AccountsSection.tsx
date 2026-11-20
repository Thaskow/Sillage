import { plural, t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { LogIn, Pencil, Play, Plug, Plus, Trash2 } from "lucide-react";
import { cx } from "@/lib/cx";
import {
  errorMessage,
  profilesIpc,
  type Profile,
  type Provider,
} from "@/lib/ipc";
import {
  Button,
  Field,
  IconButton,
  Input,
  Switch,
} from "@/design-system/primitives";
import { toast } from "@/design-system/toast";
import { Dialog } from "@/design-system/overlays";
import { askConfirm } from "@/design-system/confirm";
import { groupColors } from "@/design-system/group-visuals";
import { newSession } from "@/features/sessions/actions";
import { useSessions } from "@/features/sessions/store";
import { useWorkspace } from "@/features/workspace/store";
import { AccountAvatar } from "./ProfileBadge";
import {
  accountLine,
  providerLabel,
  randomAccountName,
  useProfiles,
} from "./store";

type Editing = { mode: "create" } | { mode: "edit"; profile: Profile } | null;

export function AccountsSection() {
  const profiles = useProfiles((s) => s.profiles);
  const load = useProfiles((s) => s.load);
  const remove = useProfiles((s) => s.remove);
  const kinds = useSessions((s) => s.kinds);
  const [editing, setEditing] = useState<Editing>(null);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const installed = (p: Provider) => !!kinds.find((k) => k.kind === p)?.path;

  const confirmRemove = async (p: Profile) => {
    const ok = await askConfirm({
      title: t("Retirer le compte « {name} » ?", { name: p.name }),
      description: p.managed
        ? t(
            "Le compte disparaît de Sillage et son dossier de configuration (connexion, historique et réglages de ce compte) est supprimé. Les sessions qui l'utilisaient passent sur le compte habituel.",
          )
        : t(
            "Le compte disparaît de Sillage. Son dossier ({dir}) n'est pas touché. Les sessions qui l'utilisaient passent sur le compte habituel.",
            { dir: p.configDir },
          ),
      confirmLabel: t("Retirer"),
      danger: true,
    });
    if (!ok || !(await remove(p.id, p.managed))) return;
    useSessions.setState((st) => ({
      defs: st.defs.map((d) =>
        d.profileId === p.id ? { ...d, profileId: null } : d,
      ),
    }));
    useWorkspace.setState((st) => ({
      groups: st.groups.map((g) =>
        g.defaultProfileId === p.id ? { ...g, defaultProfileId: null } : g,
      ),
    }));
  };

  const copyMcp = async (p: Profile) => {
    try {
      const r = await profilesIpc.copyMcp(p.id);
      if (!r.added.length && !r.skipped.length) {
        toast.info(t("Aucun serveur MCP dans votre configuration habituelle"));
      } else {
        toast.info(
          r.added.length
            ? plural(
                r.added.length,
                "{n} serveur MCP copié vers « {name} »",
                "{n} serveurs MCP copiés vers « {name} »",
                { name: p.name },
              )
            : t("Serveurs MCP déjà présents"),
          [
            r.added.join(", "),
            r.skipped.length
              ? t("déjà présents : {list}", { list: r.skipped.join(", ") })
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
        );
      }
    } catch (e) {
      toast.error(t("Copie des serveurs MCP impossible"), errorMessage(e));
    }
  };

  return (
    <section className="mt-8">
      <div className="mb-1 flex items-end justify-between">
        <h2 className="text-[11px] font-medium tracking-[0.05em] text-fg-3 uppercase">
          {t("Comptes")}
        </h2>
        <Button
          variant="ghost"
          className="h-[var(--row-sm)] px-2 text-[var(--fs-sm)]"
          onClick={() => setEditing({ mode: "create" })}
        >
          <Plus size={13} /> {t("Ajouter un compte")}
        </Button>
      </div>
      <div className="divide-y divide-line rounded-lg border border-line bg-surface">
        <div className="px-4 py-3 text-[var(--fs-sm)] text-fg-3">
          {t(
            "Chaque compte a son propre dossier de configuration : connexion, historique et réglages restent séparés. Sillage ne copie ni ne conserve aucun jeton : il lit seulement celui de Claude Code pour relever les limites du forfait, ce que vous pouvez désactiver dans Agents. La connexion se fait dans Claude Code ou Codex. Sans compte choisi, une session utilise votre configuration habituelle.",
          )}
        </div>
        {profiles.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-3">
            <AccountAvatar provider={p.provider} profile={p} size={30} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{p.name}</span>
                <span className="rounded-[4px] bg-sunken px-1.5 text-[10.5px] leading-[18px] text-fg-3">
                  {providerLabel[p.provider]}
                </span>
              </div>
              <div
                className={cx(
                  "truncate text-[var(--fs-sm)]",
                  p.status.signedIn ? "text-fg-2" : "text-wait",
                )}
              >
                {accountLine(p)}
              </div>
              <div className="truncate text-[11px] text-fg-3">
                {sharingLine(p)}
              </div>
              <div
                className="truncate font-mono text-[11px] text-fg-3"
                title={p.configDir}
              >
                {p.configDir}
              </div>
            </div>
            <Button
              variant={p.status.signedIn ? "secondary" : "primary"}
              disabled={!installed(p.provider)}
              title={
                installed(p.provider)
                  ? undefined
                  : t("{name} est introuvable sur cette machine", {
                      name: providerLabel[p.provider],
                    })
              }
              onClick={() => void newSession(p.provider, p.id)}
            >
              {p.status.signedIn ? <Play size={13} /> : <LogIn size={13} />}
              {p.status.signedIn ? t("Ouvrir") : t("Se connecter")}
            </Button>
            {p.provider === "claude" && (
              <IconButton
                label={t("Copier mes serveurs MCP habituels dans ce compte")}
                onClick={() => void copyMcp(p)}
              >
                <Plug size={14} />
              </IconButton>
            )}
            <IconButton
              label={t("Modifier")}
              onClick={() => setEditing({ mode: "edit", profile: p })}
            >
              <Pencil size={14} />
            </IconButton>
            <IconButton
              label={t("Retirer")}
              onClick={() => void confirmRemove(p)}
            >
              <Trash2 size={14} />
            </IconButton>
          </div>
        ))}
      </div>
      <AccountDialog editing={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

function sharingLine(p: Profile): string {
  if (!p.shareConfig) return t("Configuration séparée");
  if (!p.sharing.source) return t("Configuration partagée : rien à partager");
  const parts = [
    p.sharing.shared.length
      ? t("Partagé avec la configuration habituelle : {list}", {
          list: p.sharing.shared.join(", "),
        })
      : t("Partage actif, rien encore à partager"),
  ];
  if (p.sharing.failed.length)
    parts.push(
      t("non partagé : {list}", { list: p.sharing.failed.join(", ") }),
    );
  return parts.join(" · ");
}

function AccountDialog({
  editing,
  onClose,
}: {
  editing: Editing;
  onClose: () => void;
}) {
  const create = useProfiles((s) => s.create);
  const update = useProfiles((s) => s.update);
  const count = useProfiles((s) => s.profiles.length);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<Provider>("claude");
  const [color, setColor] = useState(groupColors[4]!);
  const [dir, setDir] = useState("");
  const [share, setShare] = useState(true);
  const [autoName, setAutoName] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) return;
    if (editing.mode === "edit") {
      setName(editing.profile.name);
      setColor(editing.profile.color);
      setShare(editing.profile.shareConfig);
    } else {
      setShare(true);
      setName(
        randomAccountName(
          "claude",
          useProfiles.getState().profiles.map((p) => p.name),
        ),
      );
      setProvider("claude");
      setAutoName(true);
      setColor(groupColors[(count + 4) % groupColors.length]!);
      setDir("");
    }
  }, [editing, count]);

  const submit = async () => {
    if (!editing || !name.trim() || busy) return;
    setBusy(true);
    if (editing.mode === "edit") {
      await update(editing.profile.id, {
        name,
        color,
        ...(share !== editing.profile.shareConfig && { shareConfig: share }),
      });
      onClose();
    } else {
      const p = await create({
        name,
        color,
        provider,
        configDir: dir.trim() || null,
        shareConfig: share,
      });
      if (p) onClose();
    }
    setBusy(false);
  };

  return (
    <Dialog
      open={!!editing}
      onOpenChange={(o) => !o && onClose()}
      title={
        editing?.mode === "edit"
          ? t("Modifier le compte")
          : t("Ajouter un compte")
      }
      description={
        editing?.mode === "edit"
          ? undefined
          : t(
              "Après l'ajout, « Se connecter » ouvre l'outil avec ce compte : connectez-vous avec la procédure officielle.",
            )
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || busy}
            onClick={() => void submit()}
          >
            {editing?.mode === "edit" ? t("Enregistrer") : t("Ajouter")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t("Nom")}>
          <Input
            autoFocus
            value={name}
            maxLength={40}
            placeholder={t("Perso, Travail, Client X…")}
            onChange={(e) => {
              setName(e.target.value);
              setAutoName(false);
            }}
          />
        </Field>
        {editing?.mode === "create" && (
          <Field label={t("Outil")}>
            <div role="radiogroup" className="flex gap-2">
              {(["claude", "codex"] as Provider[]).map((p) => (
                <button
                  type="button"
                  key={p}
                  role="radio"
                  aria-checked={provider === p}
                  onClick={() => {
                    setProvider(p);
                    if (autoName)
                      setName(
                        randomAccountName(
                          p,
                          useProfiles.getState().profiles.map((x) => x.name),
                        ),
                      );
                  }}
                  className={cx(
                    "transition-quick h-[var(--row)] flex-1 rounded-md border px-3",
                    provider === p
                      ? "border-accent bg-accent/10 font-medium text-fg"
                      : "border-line text-fg-2 hover:bg-hover",
                  )}
                >
                  {providerLabel[p]}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label={t("Couleur")}>
          <div className="flex gap-2">
            {groupColors.map((c) => (
              <button
                type="button"
                key={c}
                aria-label={t("Couleur {color}", { color: c })}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                style={{ background: c }}
                className={cx(
                  "transition-quick size-6 rounded-full",
                  color === c
                    ? "ring-2 ring-fg ring-offset-2 ring-offset-raised"
                    : "opacity-80 hover:opacity-100",
                )}
              />
            ))}
          </div>
        </Field>
        <div className="flex items-start gap-3 rounded-md border border-line px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {t("Partager ma configuration habituelle")}
            </div>
            <div className="mt-0.5 text-[var(--fs-sm)] text-fg-3">
              {(editing?.mode === "edit"
                ? editing.profile.provider
                : provider) === "codex"
                ? t(
                    "config.toml (dont les serveurs MCP), AGENTS.md, prompts, skills et règles restent les mêmes que dans votre configuration habituelle. La connexion, l'historique et la mémoire restent propres à ce compte.",
                  )
                : t(
                    "CLAUDE.md, settings.json (permissions, hooks, modèle), raccourcis, skills, agents, commandes, plugins et styles restent les mêmes que dans votre configuration habituelle. La connexion, l'historique et la mémoire restent propres à ce compte.",
                  )}
            </div>
          </div>
          <Switch
            checked={share}
            onChange={setShare}
            label={t("Partager ma configuration habituelle")}
          />
        </div>
        {editing?.mode === "create" && (
          <Field
            label={t("Dossier existant (facultatif)")}
            hint={t(
              "Laissez vide : Sillage crée un dossier dédié. Pour réutiliser un compte déjà connecté, indiquez son dossier de configuration.",
            )}
          >
            <Input
              value={dir}
              placeholder={t("Dossier géré par Sillage")}
              onChange={(e) => setDir(e.target.value)}
              className="font-mono"
            />
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
