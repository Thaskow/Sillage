import { t } from "@/lib/i18n";
import { History } from "lucide-react";
import { EmptyState } from "@/design-system/primitives";

export function HistoryView() {
  return (
    <EmptyState icon={<History size={18} />} title={t("Historique vide")}>
      {t(
        "Les conversations Claude Code locales seront consultables et reprenables ici, sans copie vers l'extérieur.",
      )}
    </EmptyState>
  );
}
