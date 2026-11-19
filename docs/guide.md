# Guide d'utilisation

## Premiers pas

1. Installez Sillage puis lancez-le. Au premier démarrage, la barre latérale propose de **créer un premier groupe**
   (un projet, un client, vos serveurs…) ; l'**Espace libre**, en haut, permet aussi de commencer sans rien créer.
2. Dans un groupe, `Ctrl T` ouvre Claude Code, `Ctrl Maj T` un terminal PowerShell. Les menus **Agent** et
   **Terminal** en haut à droite proposent tous les outils trouvés sur la machine (Claude Code, Codex, PowerShell 7,
   invite de commandes, WSL).
3. `Ctrl K` ouvre la palette : groupes, sessions et actions au clavier.

Si un outil est « introuvable », installez-le ou ajoutez-le au `PATH`, puis relancez Sillage.

## Groupes et espace libre

- **Créer, modifier** : bouton `+` de la section Groupes (`Ctrl Maj N`), ou `…` en haut d'un groupe pour son
  apparence. Un groupe a un nom, une couleur, une icône, une catégorie facultative et un compte par défaut.
- **Ranger** : glissez les groupes dans la barre latérale ; épinglez les plus utilisés (`Ctrl 1` à `Ctrl 9`) ;
  archivez ceux qui ne servent plus.
- **Espace libre** : toujours présent, ni supprimable ni archivable. Quand ce qui y tourne devient un vrai projet,
  **Exporter** déplace toutes ses sessions, avec leur disposition, vers un groupe existant ou un nouveau groupe. Une
  session seule se déplace aussi par clic droit → « Déplacer vers… ».

## Panneaux et terminaux

- Disposition **côte à côte**, **empilée** ou **en grille** (en haut du groupe) ; faites glisser les séparateurs pour
  redimensionner, double-cliquez dessus pour rééquilibrer.
- Dans un terminal : sélection puis clic droit pour copier, clic droit sans sélection pour coller ; `Ctrl Maj F` pour
  rechercher ; les liens s'ouvrent dans le navigateur après confirmation.
- Clic droit sur l'en-tête d'un panneau : renommer, agrandir, déplacer, changer de compte, arrêter, relancer.

## Comptes Claude Code et Codex

Ouvrez **Agents → Comptes et réglages**.

1. **Ajouter un compte** : choisissez l'outil (Claude Code ou Codex), un nom (Sillage en propose un) et une couleur.
   Pour reprendre un compte déjà connecté ailleurs, indiquez son dossier de configuration.
2. **Se connecter** ouvre l'outil avec ce compte : connectez-vous avec sa procédure officielle. L'e-mail du compte
   s'affiche ensuite dans la liste.
3. **Partager ma configuration habituelle** (activé par défaut) : `CLAUDE.md`, `settings.json`, raccourcis, skills,
   agents, commandes, plugins et styles (ou `config.toml`, `AGENTS.md`, prompts, skills et règles pour Codex) restent
   les mêmes que dans votre configuration habituelle. La connexion, l'historique et la mémoire restent propres au
   compte.
4. Le bouton **prise** copie vos serveurs MCP habituels dans un compte Claude (seulement ceux qui manquent).

Quel compte est utilisé ? Le menu **Agent** liste chaque compte ; `Ctrl T` utilise le compte par défaut du groupe,
sinon celui choisi dans Agents, sinon le compte habituel. Chaque panneau affiche le logo de l'outil et les initiales
du compte.

## Consommation

**Agents → Consommation** affiche, pour chaque compte :

- les limites du forfait (fenêtre de 5 h et semaine), avec l'heure de réinitialisation ;
- les jetons consommés sur 5 h, aujourd'hui et 7 jours, et leur répartition par modèle.

Les chiffres de jetons sont calculés depuis l'historique local des outils. Les limites viennent de Codex (qui les
enregistre lui-même) et, pour Claude, d'Anthropic (réglage « Relever les limites du forfait Claude »).

## Reprise au redémarrage

Les sessions actives quand vous fermez Sillage sont relancées à l'ouverture : Claude Code et Codex reprennent leur
conversation, les terminaux repartent dans leur dossier (leur affichage précédent n'est pas conservé). Une session que
vous avez arrêtée reste arrêtée. Clic droit → « Nouvelle conversation au prochain lancement » repart de zéro.

## Mises à jour

Sillage recherche une nouvelle version au démarrage puis toutes les 6 heures (désactivable dans **Paramètres → Mises
à jour**). Quand une version est disponible, un bouton **Mise à jour** apparaît en haut à droite : Sillage télécharge
l'installateur, vérifie sa signature, l'installe et redémarre. Les sessions en cours sont reprises.

## Raccourcis

| Raccourci | Action |
|---|---|
| `Ctrl K` | Palette de commandes |
| `Ctrl T` | Nouvelle session Claude Code |
| `Ctrl Maj T` | Nouveau terminal PowerShell |
| `Ctrl Maj N` | Nouveau groupe |
| `Ctrl W` | Fermer la session active |
| `Ctrl Tab` / `Ctrl Maj Tab` | Session suivante / précédente |
| `Ctrl 1` … `Ctrl 9` | Groupe épinglé 1 à 9 |
| `Ctrl B` | Barre latérale |
| `Ctrl Maj F` | Rechercher dans le terminal |

## Désinstaller

Windows : Paramètres → Applications → Sillage → Désinstaller. Les données restent dans
`%LOCALAPPDATA%\fr.thaskow.sillage\` ; supprimez ce dossier pour tout effacer (y compris les dossiers des comptes
ajoutés dans Sillage).
