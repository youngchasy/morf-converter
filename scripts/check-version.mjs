import { readFileSync } from "node:fs";

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const tauriVersion = JSON.parse(
  readFileSync("src-tauri/tauri.conf.json", "utf8")
).version;
const windowsConfig = JSON.parse(
  readFileSync("src-tauri/tauri.windows.conf.json", "utf8")
);
const cargoText = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = {
  "package.json": packageVersion,
  "src-tauri/Cargo.toml": cargoVersion,
  "src-tauri/tauri.conf.json": tauriVersion
};
const unique = new Set(Object.values(versions));
const errors = [];

if (!packageVersion || !cargoVersion || !tauriVersion || unique.size !== 1) {
  errors.push(
    `Morf version mismatch:\n${Object.entries(versions)
      .map(([file, version]) => `- ${file}: ${version ?? "not found"}`)
      .join("\n")}`
  );
}

const windowsTargets = windowsConfig.bundle?.targets;
if (
  !Array.isArray(windowsTargets) ||
  windowsTargets.length !== 1 ||
  windowsTargets[0] !== "nsis"
) {
  errors.push("Windows Alpha bundle must target NSIS only.");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Morf version OK: ${packageVersion}; Windows bundle: NSIS`);
