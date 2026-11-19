# Sillage

Espace de travail local pour Windows qui réunit agents IA (Claude Code, Codex…) et terminaux, organisés en groupes.
Aucun compte, aucun cloud, aucune télémétrie : tout reste sur la machine.

## Fonctionnalités

- **Groupes et espace libre** : sessions rangées par groupe (couleur, icône, catégories, épinglage, archivage), et un
  espace libre pour lancer des terminaux sans rien configurer puis l'exporter vers un groupe.
- **Terminaux réels** : ConPTY + xterm.js, PowerShell, PowerShell 7, invite de commandes, WSL, Claude Code, Codex ;
  plusieurs panneaux côte à côte, empilés ou en grille.
- **Comptes multiples** : plusieurs comptes Claude Code ou Codex, chacun dans son dossier de configuration, avec
  partage optionnel de la configuration habituelle (`CLAUDE.md`, réglages, skills, agents, plugins…) et copie des
  serveurs MCP.
- **Reprise au redémarrage** : les sessions actives à la fermeture sont relancées ; Claude Code et Codex reprennent
  leur conversation.
- **Consommation** : jetons consommés par compte (5 h, jour, semaine, par modèle) et limites du forfait (Claude et
  Codex).
- **Activité** : état des agents de tous les groupes.
- Palette de commandes, thèmes clair et sombre, raccourcis clavier.

L'avancement est détaillé dans [docs/roadmap.md](docs/roadmap.md).

## Installer

Lancer `Sillage_<version>_x64-setup.exe`. L'installation est faite pour l'utilisateur courant, sans droits
administrateur. WebView2 doit être présent (il l'est sur Windows 11).

Données : `%LOCALAPPDATA%\fr.thaskow.sillage\sillage.db` (SQLite). Voir [docs/data.md](docs/data.md).

## Compiler

Le build Windows est produit depuis Linux par compilation croisée (`cargo-xwin`, installateur NSIS), dans une image
Docker qui contient toute la chaîne d'outils :

```sh
docker build -t sillage-builder tools/builder
docker run --rm -v "$PWD":/src -v sillage-cargo-registry:/usr/local/cargo/registry \
  -v sillage-xwin:/cache/xwin -v sillage-npm:/root/.npm sillage-builder bash -c '
  npm ci &&
  npm run typecheck && npm test &&
  cargo test -p sillage-core &&
  npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc'
```

L'installateur est écrit dans `target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

Sur une machine Windows avec Rust et les MSVC Build Tools, `npm ci && npm run tauri build` suffit.

Développement de l'interface sans Tauri : `npm run dev` puis ouvrir `http://127.0.0.1:1420` (un backend simulé
en mémoire est injecté uniquement en mode développement ; `?empty` démarre sans données).

## Documentation

- [Architecture](docs/architecture.md)
- [Sécurité et confidentialité](docs/security.md)
- [Données stockées](docs/data.md)
- [Feuille de route](docs/roadmap.md)

## Licence

MIT. Polices incluses : Geist et JetBrains Mono (SIL Open Font License 1.1).
Logos Claude ([Simple Icons](https://simpleicons.org), CC0) et Codex ([Lobe Icons](https://github.com/lobehub/lobe-icons), MIT),
utilisés pour désigner ces outils ; les marques appartiennent à leurs détenteurs. Sillage n'est pas affilié à
Anthropic ni à OpenAI.
