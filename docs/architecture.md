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
  Une base illisible est renommée (`sillage.corrupt-<horodatage>.db`) puis recréée : jamais supprimée.
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
