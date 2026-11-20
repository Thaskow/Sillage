import { afterEach, describe, expect, it } from "vitest";
import { en } from "./en";
import { plural, resolveLang, t, translateError, useLang } from "./index";

const sources = import.meta.glob<string>(
  ["/src/**/*.{ts,tsx}", "!/src/**/*.test.*"],
  { query: "?raw", import: "default", eager: true },
);

function literalKeys(src: string): string[] {
  const keys: string[] = [];
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g))
    keys.push(JSON.parse(`"${m[1]}"`) as string);
  for (const m of src.matchAll(
    /\bplural\(\s*[^,]+,\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"/g,
  ))
    keys.push(JSON.parse(`"${m[1]}"`), JSON.parse(`"${m[2]}"`));
  return keys;
}

describe("i18n", () => {
  afterEach(() => useLang.setState({ lang: "fr" }));

  it("has an English translation for every literal key", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30);
    const missing = Object.entries(sources).flatMap(([file, src]) =>
      literalKeys(src)
        .filter((k) => !(k in en))
        .map((k) => `${file}: ${k}`),
    );
    expect(missing).toEqual([]);
  });

  it("keeps the same placeholders in both languages", () => {
    const vars = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const broken = Object.entries(en).filter(([fr, e]) => {
      const a = vars(fr);
      const b = vars(e);
      return a.length !== b.length || a.some((v, i) => v !== b[i]);
    });
    expect(broken).toEqual([]);
  });

  it("translates, interpolates and pluralizes", () => {
    expect(t("Mise à jour {version}", { version: "1.0" })).toBe(
      "Mise à jour 1.0",
    );
    useLang.setState({ lang: "en" });
    expect(t("Mise à jour {version}", { version: "1.0" })).toBe("Update 1.0");
    expect(t("texte sans traduction")).toBe("texte sans traduction");
    expect(
      plural(0, "{n} session sur 7 jours", "{n} sessions sur 7 jours"),
    ).toBe("0 sessions over 7 days");
  });

  it("resolves the system language", () => {
    expect(resolveLang("system", "fr-CA")).toBe("fr");
    expect(resolveLang("system", "de-DE")).toBe("en");
    expect(resolveLang("fr", "en-US")).toBe("fr");
  });

  it("translates backend errors", () => {
    useLang.setState({ lang: "en" });
    expect(
      translateError("valeur invalide : le nom ne peut pas être vide"),
    ).toBe("invalid value: the name cannot be empty");
    expect(translateError("introuvable : groupe abc")).toBe(
      "not found: group abc",
    );
    expect(
      translateError(
        "impossible de démarrer « claude » : le dossier C:\\x n'existe plus",
      ),
    ).toBe("could not start “claude”: folder C:\\x no longer exists");
    useLang.setState({ lang: "fr" });
    expect(translateError("introuvable : groupe abc")).toBe(
      "introuvable : groupe abc",
    );
  });
});
