import { readFileSync } from "node:fs";

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const tauriVersion = JSON.parse(
  readFileSync("src-tauri/tauri.conf.json", "utf8")
).version;
const cargoText = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = {
  "package.json": packageVersion,
  "src-tauri/Cargo.toml": cargoVersion,
  "src-tauri/tauri.conf.json": tauriVersion
};
const unique = new Set(Object.values(versions));

if (!packageVersion || !cargoVersion || !tauriVersion || unique.size !== 1) {
  console.error("Morf version mismatch:");
  for (const [file, version] of Object.entries(versions)) {
    console.error(`- ${file}: ${version ?? "not found"}`);
  }
  process.exit(1);
}

console.log(`Morf version OK: ${packageVersion}`);
