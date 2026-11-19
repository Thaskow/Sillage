import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, version, notesFile] = process.argv.slice(2);
if (!dir || !/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("usage : node scripts/latest-json.mjs <dossier> <version> [notes.md]");
  process.exit(1);
}

const base = `https://github.com/Thaskow/sillage/releases/download/v${version}`;
const files = {
  "windows-x86_64": `Sillage_${version}_x64-setup.exe`,
  "darwin-aarch64": "Sillage_aarch64.app.tar.gz",
  "darwin-x86_64": "Sillage_x64.app.tar.gz",
};

const platforms = {};
for (const [platform, file] of Object.entries(files)) {
  const sig = join(dir, `${file}.sig`);
  if (!existsSync(sig)) continue;
  platforms[platform] = {
    signature: readFileSync(sig, "utf8").trim(),
    url: `${base}/${file}`,
  };
}
if (!platforms["windows-x86_64"]) {
  console.error("signature Windows absente");
  process.exit(1);
}

const notes =
  notesFile && existsSync(notesFile) ? readFileSync(notesFile, "utf8").trim() : "";
process.stdout.write(
  JSON.stringify(
    { version, notes, pub_date: new Date().toISOString(), platforms },
    null,
    2,
  ) + "\n",
);
