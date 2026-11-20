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
- **Fenêtre sans décoration système** : barre de titre dessinée par l'app (zone de glissement `data-tauri-drag-region`),
  boutons Windows reproduits. La fenêtre est affichée une fois le premier rendu prêt (évite le flash blanc), avec un
  filet de sécurité côté Rust après 2,5 s.
- **Compilation croisée depuis Linux** (`cargo-xwin`) : le poste de développement n'a pas besoin des MSVC Build Tools.
  Limite : seuls les tests indépendants de Windows tournent en CI Linux ; ConPTY, Named Pipes et DPAPI sont validés
  en lançant l'application sur Windows.
- **États des agents par les hooks Claude Code** : chaque session Claude reçoit `--settings <données>/claude-hooks.json`
  (la configuration de l'utilisateur n'est pas modifiée). Les hooks `UserPromptSubmit`/`PostToolUse` (travaille),
  `Notification` (attend une validation) et `Stop` (a terminé) appellent `Sillage.exe --hook <état>`, qui écrit
  `<données>/hooks/<session>.state`. L'app scrute ce dossier (300 ms) et émet `agent-activity`. La commande est le nom
  nu de l'exécutable, résolu par le `PATH` de la session : Claude Code peut lancer ses hooks dans PowerShell, bash ou
  cmd.
- **Pas d'état global monolithique** : stores par fonctionnalité, sélecteurs fins ; les terminaux (lot 2) écriront
  directement dans xterm.js sans passer par React.

## Sessions persistantes (lot 2b)

Crate `crates/sillage-host` : protocole (`proto`), démon (`server`), client (`client`), sécurité Windows
(`security`) et `Backend`, qui remplace `PtyManager` dans `AppState`.

- **Même exécutable, mode `--host`** (intercepté dans `main.rs` comme `--hook`) : rien de plus à empaqueter. L'app le
  copie dans `<données>/host/sillage-host-<version>.exe` (avec les DLL voisines) et le lance détaché
  (`DETACHED_PROCESS`, hors Job Object si possible) : la mise à jour de `Sillage.exe` ne bute jamais sur un fichier
  verrouillé et l'ancien démon garde ses sessions. Pas de service Windows, pas de droits admin.
- **Canal** : `\\.\pipe\sillage-<SID>` (`sillage-dev-<SID>` en debug), descripteur `O:<SID>G:<SID>D:P(A;;GA;;;<SID>)`
  (seul l'utilisateur courant, DACL protégée), `PIPE_REJECT_REMOTE_CLIENTS`, première instance exclusive (un second
  démon ne peut pas prendre le nom). Le client vérifie que le propriétaire du canal est son propre SID avant d'envoyer
  quoi que ce soit (contre un autre compte qui aurait créé le nom en premier). Aucune écoute réseau.
- **Protocole** : trames `u32` longueur + type (0 = JSON, 1 = sortie binaire `id` + octets), 1 Mio max côté client.
  JSON strict (`deny_unknown_fields`), poignée de main versionnée (`PROTOCOL`), identifiants `[A-Za-z0-9_-]{1,64}`,
  tailles 2–1000, chaînes sans NUL et bornées. Trame ou JSON invalide : connexion fermée ; requête invalide : erreur.
- **Sessions** : le démon garde les 512 Kio de sortie récents par session. `start_session` tente d'abord `attach` :
  si la session vit dans le démon, le tampon est rejoué puis le flux continue sans relancer le processus (les
  `--settings`, `SILLAGE_SESSION_ID`, `SILLAGE_HOOK_DIR` et `PATH` des hooks ne sont posés qu'au lancement, par
  l'app). L'app envoie son environnement complet à chaque lancement, le démon pouvant être plus ancien qu'elle. Les
  sessions terminées pendant que l'app était fermée sont listées par le démon et ne sont pas relancées (`reconcile`).
- **Cycle de vie** : fermer la fenêtre détache (seules les sessions en processus sont tuées). Le démon s'arrête
  après 30 s sans session ni client. Après un redémarrage de Windows il n'existe plus : la reprise du lot 4b
  s'applique.
- **Repli** : démon injoignable ou de version incompatible (ou variable `SILLAGE_NO_HOST`) : PTY en processus comme
  au lot 2a, nouvel essai de connexion au plus toutes les 15 s.
- Reste à faire : « Terminer » propre et « Forcer » par Job Object, action « Détacher » dans l'interface, conserver
  l'état des hooks au redémarrage de l'app (`hooks::prepare` vide encore le dossier).
