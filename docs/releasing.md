# Publier une version

## Chaîne

1. Les commits suivent [Conventional Commits](https://www.conventionalcommits.org/fr/) (`feat:`, `fix:`, `docs:`…).
2. À chaque push sur `main`, **release-please** (`.github/workflows/release.yml`) tient à jour une PR
   `chore(main): release x.y.z` : `CHANGELOG.md` et version dans `package.json`, `Cargo.toml` et
   `src-tauri/tauri.conf.json`.
3. Fusionner cette PR crée le tag `vx.y.z` et lance **build** (`.github/workflows/build.yml`) :
   - `bundle` compile l'installateur Windows (NSIS) et les `.dmg` macOS (Apple Silicon et Intel), plus les archives
     `.app.tar.gz` utilisées par les mises à jour macOS ;
   - `publish`, dans l'environnement protégé `release` (réservé aux tags `v*`), signe les fichiers de mise à jour
     à partir des seuls artefacts, génère `latest.json` et `SHA256SUMS.txt`, puis crée la Release GitHub.
4. Les applications installées lisent `https://github.com/Thaskow/sillage/releases/latest/download/latest.json`,
   vérifient la signature avec la clé publique de `src-tauri/tauri.conf.json` et proposent la mise à jour.

Un tag `v*` poussé à la main déclenche la même publication. `workflow_dispatch` sur `build` compile sans publier.

## Clé de signature des mises à jour

- Clé publique : `plugins.updater.pubkey` dans `src-tauri/tauri.conf.json`.
- Clé privée et mot de passe : secrets `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` de
  l'environnement GitHub `release`, avec une copie de secours hors du dépôt chez le mainteneur. Jamais dans le dépôt.
- Perdre la clé privée oblige les utilisateurs à réinstaller une fois à la main la version signée par une nouvelle
  clé. La remplacer : `npx tauri signer generate`, mettre à jour la clé publique et les deux secrets.

## Signature de code

Les installateurs ne sont pas encore signés par un certificat Windows (SmartScreen) ni notarisés par Apple. La
signature des mises à jour Tauri est indépendante et toujours active.
