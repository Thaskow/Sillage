import { create } from "zustand";
import type { Language } from "@/lib/ipc";
import { en } from "./en";

export type Lang = "fr" | "en";

type Vars = Record<string, string | number>;

export const useLang = create<{ lang: Lang }>(() => ({ lang: "fr" }));

export function resolveLang(
  pref: Language,
  browser = navigator.language,
): Lang {
  if (pref !== "system") return pref;
  return browser.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function setLang(lang: Lang) {
  document.documentElement.lang = lang;
  if (useLang.getState().lang !== lang) useLang.setState({ lang });
}

export function locale(): string {
  return useLang.getState().lang === "en" ? "en-US" : "fr-FR";
}

export function t(fr: string, vars?: Vars): string {
  const s = useLang.getState().lang === "en" ? (en[fr] ?? fr) : fr;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in vars ? String(vars[k]) : m,
  );
}

export function plural(n: number, one: string, many: string, vars?: Vars) {
  const several = useLang.getState().lang === "en" ? n !== 1 : n > 1;
  return t(several ? many : one, { n, ...vars });
}

const prefixes: Record<string, string> = {
  "base locale": "local database",
  fichier: "file",
  "données invalides": "invalid data",
  introuvable: "not found",
  "valeur invalide": "invalid value",
  intégrité: "integrity",
};

const errorRules: [RegExp, string][] = [
  [/^session (.+) introuvable ou terminée$/, "session $1 not found or ended"],
  [/^session (.+) déjà démarrée$/, "session $1 already started"],
  [/^impossible de démarrer « (.+) » : (.*)$/s, "could not start “$1”: $2"],
  [/^le dossier (.+) n'existe plus$/, "folder $1 no longer exists"],
  [
    /^(.+) est introuvable sur cette machine$/,
    "$1 was not found on this machine",
  ],
  [/^Anthropic a répondu (\d+)$/, "Anthropic answered $1"],
  [/^(compte|session|groupe) (.+)$/, "$1 $2"],
  [/^chemin refusé : (.+)$/, "path refused: $1"],
  [/^modification de (.+)$/, "change to $1"],
  [/^conversation (.+)$/, "conversation $1"],
  [/^couleur « (.+) »$/, "color “$1”"],
  [/^icône « (.+) »$/, "icon “$1”"],
  [
    /^l'argument « (.+) » contient un caractère que cmd\.exe interpréterait \(.*\) : (.+) est un script \.cmd ou \.bat$/s,
    'argument “$1” contains a character cmd.exe would interpret (& | < > ^ % ! "): $2 is a .cmd or .bat script',
  ],
];

const nouns: Record<string, string> = {
  compte: "account",
  session: "session",
  groupe: "group",
};

export function translateError(msg: string): string {
  if (useLang.getState().lang !== "en") return msg;
  const sep = msg.indexOf(" : ");
  if (sep > 0) {
    const head = msg.slice(0, sep);
    if (head in prefixes)
      return `${prefixes[head]}: ${translateError(msg.slice(sep + 3))}`;
  }
  if (en[msg]) return en[msg];
  for (const [re, out] of errorRules) {
    const m = re.exec(msg);
    if (m)
      return out.replace(/\$(\d)/g, (_, i: string) => {
        const v = m[Number(i)] ?? "";
        return nouns[v] ?? translateError(v);
      });
  }
  const tail = msg.lastIndexOf(" : ");
  if (tail > 0 && en[msg.slice(0, tail)])
    return `${en[msg.slice(0, tail)]}: ${msg.slice(tail + 3)}`;
  return msg;
}
