import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const url = process.env.SILLAGE_URL ?? "http://127.0.0.1:1420/?empty";
const out = process.argv[2] ?? "docs/screenshots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1720, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
await page.goto(url);
await page.getByText("Bienvenue dans Sillage").waitFor();
await page.evaluate(() => document.fonts.ready);

await page.evaluate(async () => {
  const mod = (p) => import(/* @vite-ignore */ p);
  const { useWorkspace } = await mod("/src/features/workspace/store.ts");
  const { useSessions } = await mod("/src/features/sessions/store.ts");
  const { newSession } = await mod("/src/features/sessions/actions.ts");
  const { useProfiles } = await mod("/src/features/profiles/store.ts");
  const { terminals } = await mod("/src/features/sessions/terminal-registry.ts");
  const { useSettings } = await mod("/src/features/settings/store.ts");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await useSettings.getState().update({ theme: "dark" });

  const ws = useWorkspace.getState();
  const client = await ws.createCategory("Clients");
  const g = (name, color, icon, extra = {}) =>
    useWorkspace
      .getState()
      .createGroup({ name, color, icon, categoryId: null, ...extra });
  const atlas = await g("Atlas — API", "#3d6fb0", "code");
  await useWorkspace.getState().updateGroup(atlas.id, { pinned: true });
  await g("Site vitrine", "#c0563f", "globe");
  await g("Boutique", "#2c6b63", "rocket", { categoryId: client.id });
  await g("Studio mobile", "#6a5bb5", "sparkles", { categoryId: client.id });
  await g("Serveurs", "#5f6670", "server");

  const orion = await useProfiles.getState().create({
    name: "Claude Orion",
    color: "#6a5bb5",
    provider: "claude",
  });
  await useProfiles.getState().create({
    name: "Codex Vega",
    color: "#c28a2c",
    provider: "codex",
  });
  useProfiles.setState((s) => ({
    profiles: s.profiles.map((p, i) => ({
      ...p,
      status: {
        initialized: true,
        signedIn: true,
        email: i === 0 ? "orion@exemple.dev" : "vega@exemple.dev",
        organization: i === 0 ? "Studio Exemple" : null,
      },
    })),
  }));

  useWorkspace.getState().select(atlas.id);
  await newSession("claude", null);
  await newSession("claude", orion.id);
  await newSession("powershell");
  await wait(400);

  const [a, b, c] = useSessions
    .getState()
    .defs.filter((d) => d.groupId === atlas.id);
  const dim = (t) => `\x1b[2m${t}\x1b[0m`;
  const accent = (t) => `\x1b[38;5;173m${t}\x1b[0m`;
  const green = (t) => `\x1b[32m${t}\x1b[0m`;
  const lines = (...l) => l.join("\r\n") + "\r\n";
  terminals.print(
    a.id,
    lines(
      `${accent("✻")} Session reprise · ${dim("atlas-api")}`,
      "",
      `${dim(">")} Ajoute la pagination à /orders`,
      "  et les tests associés",
      "",
      `${accent("●")} Je lis le contrôleur et le dépôt.`,
      dim("  ⎿  src/orders/controller.ts"),
      dim("     src/orders/repository.ts"),
      "",
      `${accent("●")} Pagination par curseur ajoutée :`,
      "  paramètres limit et after,",
      "  réponse { items, nextCursor }.",
      dim("  ⎿  3 fichiers modifiés, +118 −24"),
      "",
      `${accent("●")} 12 nouveaux tests (bornes, curseur`,
      "  invalide, tri stable).",
      `  ${green("✓")} 214 tests réussis`,
      "",
      `${dim(">")} `,
    ),
  );
  terminals.print(
    b.id,
    lines(
      `${accent("✻")} Nouvelle conversation · ${dim("atlas-api")}`,
      "",
      `${dim(">")} Relis la PR #42 côté sécurité`,
      "",
      `${accent("●")} Trois points relevés dans la PR #42 :`,
      "",
      "  1. Le jeton de réinitialisation",
      "     n'expire jamais.",
      "  2. Comparaison du mot de passe",
      "     pas à temps constant.",
      "  3. Les erreurs 500 exposent",
      "     la trace de la pile.",
      "",
      `${accent("●")} Je prépare les correctifs ?`,
      "",
      `${dim(">")} `,
    ),
  );
  terminals.print(
    c.id,
    lines(
      "PS C:\\projets\\atlas-api> git status --short",
      " M src/orders/controller.ts",
      " M src/orders/repository.ts",
      "?? src/orders/pagination.test.ts",
      "PS C:\\projets\\atlas-api> npm test",
      "",
      `${green(" ✓")} orders/pagination.test.ts (12)`,
      `${green(" ✓")} orders/controller.test.ts (31)`,
      `${green(" ✓")} auth/session.test.ts (18)`,
      "",
      ` Test Files  ${green("24 passed")} (24)`,
      `      Tests  ${green("214 passed")} (214)`,
      "PS C:\\projets\\atlas-api> ",
    ),
  );
  useSessions.getState().focus(a.id);
});

const shot = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png` });
};

await shot("workspace");

await page.keyboard.press("Control+k");
await page.getByRole("dialog").waitFor();
await page.keyboard.type("atl");
await shot("palette");
await page.keyboard.press("Escape");

await page.getByRole("button", { name: /Agent/ }).first().click();
await shot("agent-menu");
await page.keyboard.press("Escape");

await page.evaluate(async () => {
  const { useUi } = await import(/* @vite-ignore */ "/src/app/ui-store.ts");
  useUi.getState().openAgents("usage");
});
await page.getByRole("meter").first().waitFor();
await shot("usage");

await page.getByRole("tab", { name: "Comptes et réglages" }).click();
await shot("accounts");

await page.getByRole("button", { name: "Activité" }).click();
await shot("activity");

await page.evaluate(async () => {
  const { useSettings } = await import(
    /* @vite-ignore */ "/src/features/settings/store.ts"
  );
  const { useUi } = await import(/* @vite-ignore */ "/src/app/ui-store.ts");
  await useSettings.getState().update({ theme: "light" });
  useUi.getState().setView("workspace");
});
await shot("workspace-light");

await browser.close();
