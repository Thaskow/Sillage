# Contribuer

Merci de votre intérêt pour Sillage.

## Signaler un problème

Ouvrez une [issue](https://github.com/Thaskow/sillage/issues) avec la version de Sillage (Paramètres → Stockage
local), la version de Windows ou macOS, les étapes pour reproduire et ce que vous attendiez. Pour une faille de
sécurité, suivez plutôt [SECURITY.md](SECURITY.md).

## Proposer une modification

1. Forkez le dépôt et créez une branche (`feat/…`, `fix/…`).
2. Installez les dépendances : `npm ci` (Node 24, Rust stable).
3. Avant d'ouvrir la PR, lancez les contrôles de la CI :

   ```sh
   npm run typecheck && npx prettier --check src && npm test
   cargo fmt --all --check
   cargo clippy -p sillage-core -p sillage-pty --all-targets -- -D warnings
   cargo test -p sillage-core -p sillage-pty
   ```

4. Messages de commit au format [Conventional Commits](https://www.conventionalcommits.org/fr/) : ils alimentent le
   journal des versions.

## Principes du projet

- **Local d'abord** : aucune télémétrie ; toute connexion sortante est documentée dans
  [docs/security.md](docs/security.md) et désactivable.
- **Ne jamais toucher aux jetons** des outils, sauf l'exception documentée des limites du forfait Claude.
- Interface en français, sobre et accessible au clavier.
- Une décision durable va dans `docs/`.

Architecture : [docs/architecture.md](docs/architecture.md).
