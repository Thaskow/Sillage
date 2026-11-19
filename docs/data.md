# Données stockées

Tout est dans `%LOCALAPPDATA%\fr.thaskow.sillage\` :

| Fichier | Contenu |
|---|---|
| `sillage.db` (+ `-wal`, `-shm`) | Base SQLite : groupes, catégories, définitions de sessions (type, titre, dossier, commande ; jamais leur sortie), profils, paramètres. |
| `profiles\<id>\` | Dossier de configuration d'un compte créé par Sillage (`CLAUDE_CONFIG_DIR` ou `CODEX_HOME`). Il est rempli par Claude Code ou Codex eux-mêmes (connexion, historique, réglages) ; Sillage n'y écrit rien. Supprimé quand on retire le compte. |
| `sillage.corrupt-*.db` | Ancienne base mise de côté si elle était illisible au démarrage. Peut être supprimée après vérification. |
| `EBWebView\` | Cache de WebView2 (géré par Windows). |

Sillage ne copie pas les historiques de conversation Claude Code : il les lira à la demande depuis les dossiers de
configuration de chaque profil (lot 4). Désinstaller Sillage ne supprime pas ces historiques.

Pour tout effacer : fermer Sillage puis supprimer le dossier ci-dessus. Un bouton dédié est prévu au lot 6.
