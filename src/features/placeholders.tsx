import { History } from "lucide-react";
import { EmptyState } from "@/design-system/primitives";

export function HistoryView() {
  return (
    <EmptyState icon={<History size={18} />} title="Historique vide">
      Les conversations Claude Code locales seront consultables et reprenables
      ici, sans copie vers l'extérieur.
    </EmptyState>
  );
}
