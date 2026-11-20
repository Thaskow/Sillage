import { t } from "@/lib/i18n";
import { useState } from "react";
import type { SessionDef } from "@/lib/ipc";
import { Button, Field, Input } from "@/design-system/primitives";
import { Dialog } from "@/design-system/overlays";
import { useSettings } from "@/features/settings/store";
import { useSessions } from "./store";

export function FolderDialog({
  def,
  onClose,
}: {
  def: SessionDef;
  onClose: () => void;
}) {
  const [value, setValue] = useState(def.cwd ?? "");
  const [busy, setBusy] = useState(false);
  const fallback = useSettings((s) => s.settings.defaultCwd);

  const submit = async () => {
    const next = value.trim() || null;
    if (next === (def.cwd ?? null)) return onClose();
    setBusy(true);
    const ok = await useSessions.getState().setCwd(def.id, next);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("Dossier de la session")}
      description={t(
        "Le dossier où démarre la session. Claude Code ne retient pas l'autorisation pour votre dossier personnel : choisissez un dossier de projet. Changer de dossier repart d'une nouvelle conversation.",
      )}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button variant="primary" disabled={busy} onClick={submit}>
            {t("Enregistrer")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field
          label={t("Dossier de travail")}
          hint={t("Vide : dossier par défaut des paramètres.")}
        >
          <Input
            autoFocus
            value={value}
            spellCheck={false}
            placeholder={fallback ?? "C:\\Users\\…\\projets\\mon-projet"}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}
