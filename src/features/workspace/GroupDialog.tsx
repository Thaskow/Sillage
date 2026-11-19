import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cx } from "@/lib/cx";
import { Button, Field, Input } from "@/design-system/primitives";
import { Dialog } from "@/design-system/overlays";
import {
  GroupGlyph,
  groupColors,
  groupIcons,
} from "@/design-system/group-visuals";
import { useUi } from "@/app/ui-store";
import { providerLabel, useProfiles } from "@/features/profiles/store";
import { SCRATCH_ID, useWorkspace } from "./store";
import { moveAllSessions } from "@/features/sessions/actions";

export function GroupDialog() {
  const dialog = useUi((s) => s.groupDialog);
  const close = () => useUi.getState().openGroupDialog(null);
  const groups = useWorkspace((s) => s.groups);
  const categories = useWorkspace((s) => s.categories);
  const createGroup = useWorkspace((s) => s.createGroup);
  const updateGroup = useWorkspace((s) => s.updateGroup);
  const editing =
    dialog?.mode === "edit"
      ? groups.find((g) => g.id === dialog.groupId)
      : undefined;

  const [name, setName] = useState("");
  const [color, setColor] = useState(groupColors[0]!);
  const [icon, setIcon] = useState("briefcase");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const profiles = useProfiles((s) => s.profiles);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dialog) return;
    setName(editing?.name ?? "");
    setColor(
      editing?.color ?? groupColors[groups.length % groupColors.length]!,
    );
    setIcon(editing?.icon ?? "briefcase");
    setCategoryId(editing?.categoryId ?? null);
    setProfileId(editing?.defaultProfileId ?? null);
    setBusy(false);
  }, [dialog]);

  const valid = name.trim().length > 0;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    if (editing) {
      await updateGroup(editing.id, {
        name: name.trim(),
        color,
        icon,
        categoryId,
        defaultProfileId: profileId,
      });
    } else {
      const created = await createGroup({
        name: name.trim(),
        color,
        icon,
        categoryId,
        defaultProfileId: profileId,
      });
      if (created && dialog?.mode === "create" && dialog.fromScratch)
        await moveAllSessions(SCRATCH_ID, created.id);
    }
    close();
  };

  return (
    <Dialog
      open={!!dialog}
      onOpenChange={(o) => !o && close()}
      title={editing ? "Modifier le groupe" : "Nouveau groupe"}
      description={
        editing
          ? undefined
          : "Un groupe réunit des agents et des terminaux autour d'une activité. Aucun dépôt Git n'est nécessaire."
      }
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!valid || busy} onClick={submit}>
            {editing ? "Enregistrer" : "Créer le groupe"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-3">
          <GroupGlyph icon={icon} color={color} size={36} />
          <div className="flex-1">
            <Field label="Nom">
              <Input
                autoFocus
                value={name}
                maxLength={80}
                placeholder="Travail, CStonx, Arise…"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <Field label="Couleur">
          <div role="radiogroup" aria-label="Couleur" className="flex gap-1.5">
            {groupColors.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className="transition-quick flex size-6 items-center justify-center rounded-full hover:scale-110"
                style={{ background: c }}
              >
                {color === c && (
                  <Check size={13} className="text-white" strokeWidth={2.6} />
                )}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Icône">
          <div
            role="radiogroup"
            aria-label="Icône"
            className="grid grid-cols-10 gap-1"
          >
            {Object.entries(groupIcons).map(([key, Icon]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={icon === key}
                aria-label={key}
                onClick={() => setIcon(key)}
                className={cx(
                  "transition-quick flex aspect-square items-center justify-center rounded-md",
                  icon === key
                    ? "bg-active text-fg"
                    : "text-fg-3 hover:bg-hover hover:text-fg",
                )}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
        </Field>

        {categories.length > 0 && (
          <Field label="Catégorie">
            <select
              value={categoryId ?? ""}
              onChange={(e) => setCategoryId(e.target.value || null)}
              className="h-[var(--row)] rounded-md border border-line-strong bg-raised px-2 text-fg outline-none focus:border-accent"
            >
              <option value="">Aucune</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {profiles.length > 0 && (
          <Field
            label="Compte par défaut"
            hint="Utilisé pour les nouvelles sessions de ce groupe (Ctrl T et menu Agent)."
          >
            <select
              value={profileId ?? ""}
              onChange={(e) => setProfileId(e.target.value || null)}
              className="h-[var(--row)] rounded-md border border-line-strong bg-raised px-2 text-fg outline-none focus:border-accent"
            >
              <option value="">Défaut des agents</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({providerLabel[p.provider]})
                </option>
              ))}
            </select>
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
