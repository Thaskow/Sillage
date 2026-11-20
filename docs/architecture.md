# Architecture

## Vue d'ensemble

```
┌────────────────────────── Sillage.exe (Tauri 2) ──────────────────────────┐
│  WebView2 : React + TypeScript (présentation uniquement)                  │
│        │ invoke (IPC Tauri, aucune socket réseau)                         │
│  Rust : commandes Tauri ─► sillage-core (SQLite, groupes, paramètres)     │
└───────────────────────────────────────┬───────────────────────────────────┘
                                        │ Named Pipe local, ACL utilisateur (lot 2)
┌───────────────────────────────────────▼───────────────────────────────────┐
│  sillage-host (lot 2) : démon utilisateur, possède les ConPTY et les      │
│  processus ; survit à la fermeture de la fenêtre pour les sessions        │
│  marquées persistantes ; Job Objects pour nettoyer les arbres de process. │
└───────────────────────────────────────────────────────────────────────────┘
```

## Répartition du code

| Chemin | Rôle |
|---|---|
| `crates/sillage-core` | Logique métier sans dépendance à Tauri : stockage SQLite et migrations (`storage`), groupes et catégories (`workspace`), paramètres (`settings`). Testable sous Linux. |
| `src-tauri` | Enveloppe native : fenêtre, commandes exposées au frontend, état partagé. |
| `src/design-system` | Tokens (`tokens.css`), primitives, overlays (dialogues, menus), toasts. |
| `src/features/*` | Une fonctionnalité par dossier : `workspace`, `settings`, `palette`… Chaque store Zustand est local à sa fonctionnalité. |
| `src/app` | Coquille : barre de titre, raccourcis, routage des vues. |
| `tools/builder` | Image Docker de compilation croisée Linux → Windows. |

## Décisions

- **Tauri 2 plutôt qu'Electron** : moteur WebView2 du système, binaire de quelques Mo, Rust pour la logique système.
- **SQLite embarqué (`rusqlite` bundled)** : migrations par `PRAGMA user_version`, WAL, `quick_check` à l'ouverture.
  Une base illisible est renommée (`sillage.corrupt-<horodatage>.db`) puis recréée : jamais supprimée. Seule une
  vraie corruption (`SQLITE_CORRUPT`, `SQLITE_NOTADB`, `quick_check` en échec) déclenche ce chemin ; une base
  verrouillée ou une migration en échec fait échouer le démarrage sans toucher au fichier.
- **Une seule instance** (`tauri-plugin-single-instance`) : un second lancement ramène la fenêtre existante, pour
  ne jamais relancer deux fois les mêmes conversations.
- **Commandes Tauri** : sans `async`, une commande s'exécute sur le thread de l'interface. Celles qui touchent au
  disque ou lancent un processus (`start_session`, comptes, suppressions, `available_kinds`, `usage_report`) sont
  `async`. `write_session` et `resize_session` restent synchrones : sérialisées, les frappes ne peuvent pas
  arriver dans le désordre.
- **Sortie des terminaux** : un thread lit le PTY, un second envoie au WebView tout ce qui s'est accumulé depuis le
  dernier envoi (512 Kio au plus, file bornée) ; aucune latence ajoutée, beaucoup moins de messages IPC sous forte
  sortie. xterm.js rend en WebGL tant que le panneau est affiché (contexte libéré au détachement, retour au rendu DOM
  si WebGL est absent ou perdu).
- **Langues** : le français est la langue source. `t("texte français")` (`src/lib/i18n`) renvoie la traduction
  de `en.ts` quand l'anglais est actif, sinon le texte tel quel. Un test vérifie que chaque `t("…")` littéral a sa
  traduction et que les variables `{x}` concordent. Les messages d'erreur du Rust restent en français et sont
  traduits à l'affichage (`translateError`). Changer de langue remonte l'arbre React (terminaux conservés).
- **Police de l'interface** : Geist place le texte trop bas par rapport aux icônes (ascendante 1005, descendante 295,
  centrée sur les capitales). `tools/fonts/geist-ui.py` régénère `src/design-system/fonts/geist-ui-*.woff2` avec des
  métriques 940/360 : même rendu sous WebView2 et WebKit (`ascent-override` n'existe pas dans Safari). Licence OFL
  jointe ; relancer le script après une mise à jour de `@fontsource-variable/geist`.
- **Fenêtre sans décoration système** : barre de titre dessinée par l'app (zone de glissement `data-tauri-drag-region`),
  boutons Windows reproduits. La fenêtre est affichée une fois le premier rendu prêt (évite le flash blanc), avec un
  filet de sécurité côté Rust après 2,5 s.
- **Compilation croisée depuis Linux** (`cargo-xwin`) : le poste de développement n'a pas besoin des MSVC Build Tools.
  Limite : seuls les tests indépendants de Windows tournent en CI Linux ; ConPTY, Named Pipes et DPAPI sont validés
  en lançant l'application sur Windows.
- **Pas d'état global monolithique** : stores par fonctionnalité, sélecteurs fins ; les terminaux (lot 2) écriront
  directement dans xterm.js sans passer par React.

## Sessions persistantes (lot 2, conception)

Le démon `sillage-host` est un second binaire lancé à la demande par l'app (pas de service Windows, pas de droits
admin). Il écoute sur `\\.\pipe\sillage-<SID>` avec un descripteur de sécurité limité à l'utilisateur courant et
`PIPE_REJECT_REMOTE_CLIENTS`. Il possède les ConPTY (`portable-pty`) ; l'app s'y attache, rejoue le tampon d'écran
récent puis reçoit le flux en direct. Fermer la fenêtre détache ; « Terminer » envoie un arrêt propre ; « Forcer »
ferme le Job Object. Après un redémarrage de Windows, les sessions sont marquées « terminées » avec leur historique
consultable, jamais présentées comme actives.
