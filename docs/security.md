# Sécurité et confidentialité

## Engagements vérifiables

| Engagement | Où le vérifier |
|---|---|
| Aucune ressource distante (script, CSS, police, image) | `src-tauri/tauri.conf.json` : CSP `default-src 'self'`, `connect-src ipc:` ; polices installées via `@fontsource-variable/*` et intégrées au bundle. |
| Aucune télémétrie, analytics ni crash reporting | Aucun plugin Tauri `http` ; les seules requêtes HTTP partent du code Rust vers deux destinations : GitHub (mises à jour, `tauri-plugin-updater`) et `api.anthropic.com` (limites du forfait Claude, `src-tauri/src/accounts.rs`). Le WebView reste limité par la CSP `connect-src ipc:`. |
| Mises à jour signées, jamais installées sans accord | `plugins.updater` dans `src-tauri/tauri.conf.json` : `latest.json` des Releases GitHub, signature minisign vérifiée avec la clé publique intégrée ; l'installation attend un clic (`src/features/updates`). Recherche automatique désactivable. Voir [releasing.md](releasing.md). |
| Aucun port réseau ouvert | L'IPC Tauri passe par le protocole personnalisé de WebView2 ; le serveur Vite n'existe qu'en développement (`127.0.0.1`). |
| Permissions minimales du frontend | `src-tauri/capabilities/default.json` : uniquement le contrôle de la fenêtre et les commandes de l'app. |
| Pas de droits administrateur | Installateur NSIS `currentUser`. |

Connexions sortantes de Sillage : la recherche de mises à jour (GitHub, au démarrage puis toutes les 6 heures,
désactivable dans Paramètres → Mises à jour) et le relevé des limites du forfait Claude (désactivable dans Agents).
Aucune autre.

## Comptes multiples

Un compte Sillage n'est qu'un dossier de configuration passé à l'outil au lancement (`CLAUDE_CONFIG_DIR` pour
Claude Code, `CODEX_HOME` pour Codex). La connexion se fait dans l'outil, par sa procédure officielle. Sillage ne lit,
ne copie ni ne transmet aucun jeton : pour afficher l'état d'un compte, il lit seulement `oauthAccount.emailAddress`
et `oauthAccount.organizationName` dans `.claude.json`, et vérifie la présence (sans lecture) de `.credentials.json`
ou `auth.json` (`crates/sillage-core/src/profiles.rs`, `account_status`). Retirer un compte ne supprime que les
dossiers créés par Sillage (`profiles\<id>\`), jamais un dossier existant ajouté par l'utilisateur.

**Configuration partagée** (option par compte, active par défaut, `crates/sillage-core/src/sharing.rs`) : les
réglages de la configuration habituelle (`~/.claude` ou `~/.codex`) sont reliés dans le dossier du compte, par lien
physique pour les fichiers (`CLAUDE.md`, `settings.json`, `keybindings.json` ; `config.toml`, `AGENTS.md`) et par
jonction pour les dossiers (`skills`, `agents`, `commands`, `plugins`, `output-styles` ; `prompts`, `skills`,
`rules`). Jamais la connexion, l'historique ni `.claude.json`. Un fichier déjà présent dans le compte est renommé
`<nom>.avant-partage-<horodatage>`, jamais supprimé. Désactiver le partage ou retirer le compte supprime seulement les
liens, pas les originaux. Le partage est réappliqué à chaque lancement (un outil qui remplace un fichier au lieu de
l'écrire casse le lien physique : la copie du compte est alors mise de côté de la même façon).

**Serveurs MCP** : « Copier mes serveurs MCP » ajoute au `.claude.json` du compte les entrées `mcpServers` absentes de
la configuration habituelle, sans modifier les autres clés ni les serveurs existants. Une copie de sauvegarde
`.claude.json.avant-mcp-<horodatage>` est faite avant l'écriture ; l'opération est refusée si une session du compte
tourne.

**Reprise des conversations** (`crates/sillage-core/src/resume.rs`) : Sillage donne à chaque panneau Claude Code un identifiant de conversation (`--session-id`) et le relance avec `--resume`. Pour Codex, il lit seulement la première ligne (`session_meta` : identifiant, dossier, heure) des fichiers `rollout-*.jsonl` récents pour retrouver la conversation du panneau, puis lance `codex resume <id>`. Les identifiants sont validés (hexadécimal et tirets) avant d'être passés en argument.

**Consommation** (`crates/sillage-core/src/usage.rs`) : Sillage lit l'historique local écrit par les outils
(`projects/**/*.jsonl` pour Claude Code, `sessions/**/rollout-*.jsonl` pour Codex), fichiers modifiés depuis 7 jours,
et n'en garde que les compteurs de jetons, le modèle, l'horodatage et, pour Codex, les limites du forfait qu'il
enregistre lui-même. Le contenu des conversations n'est ni conservé ni transmis.

**Limites du forfait Claude** (activé par défaut à la demande de l'utilisateur, désactivable par le réglage « Relever les limites du forfait Claude » dans Agents,
`crates/sillage-core/src/claude_limits.rs` et `src-tauri/src/accounts.rs`) : c'est la seule exception à la règle « ne
jamais manipuler les jetons », autorisée explicitement par l'utilisateur pour ce seul usage. Sillage lit
`claudeAiOauth.accessToken` dans `.credentials.json` du compte et l'envoie uniquement à
`https://api.anthropic.com/api/oauth/usage` (le relevé qu'affiche `/usage`), à l'ouverture de l'onglet Consommation puis toutes les 5 minutes tant qu'il est ouvert. Le jeton n'est ni affiché,
ni journalisé, ni copié, ni conservé, ni rafraîchi : s'il a expiré, Sillage demande d'ouvrir Claude Code avec ce compte.
Sur macOS, où Claude Code range le jeton dans le trousseau, le relevé n'est pas encore pris en charge.

Claude Code, lancé par l'utilisateur, communique avec Anthropic selon son propre fonctionnement : ces échanges ne
passent pas par Sillage.

## Prévu

- Lot 2 : Named Pipe limité au SID de l'utilisateur, `PIPE_REJECT_REMOTE_CLIENTS`, validation de chaque message.
- Lot 4 : un `CLAUDE_CONFIG_DIR` distinct par profil, jamais de lecture ni de copie des jetons ; secrets éventuels via
  le Gestionnaire d'identification Windows.
- Lot 5 : filtrage des notifications (aucun contenu de terminal, seulement titre de session et type d'événement).

## Signaler un problème

Ouvrir une issue privée (security advisory) sur le dépôt, ou contacter le mainteneur. Ne pas publier de détails
exploitables.
