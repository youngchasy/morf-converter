import { readFileSync } from "node:fs";

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const tauriVersion = tauriConfig.version;
const wixVersion = tauriConfig.bundle?.windows?.wix?.version;
const wixUpgradeCode = tauriConfig.bundle?.windows?.wix?.upgradeCode;
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

const semver = packageVersion?.match(
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
);
if (!semver) {
  errors.push(`Unsupported application version: ${packageVersion ?? "not found"}`);
} else {
  const [, majorText, minorText, patchText, prerelease = ""] = semver;
  const numericPrerelease = prerelease
    .split(".")
    .filter((part) => /^\d+$/.test(part));
  const build = Number(numericPrerelease.at(-1) ?? 0);
  const expectedWixVersion = `${majorText}.${minorText}.${patchText}.${build}`;
  const [major, minor, patch] = [majorText, minorText, patchText].map(Number);

  if (major > 255 || minor > 255 || patch > 65_535 || build > 65_535) {
    errors.push("Version fields exceed the MSI limits (255.255.65535.65535).");
  }
  if (wixVersion !== expectedWixVersion) {
    errors.push(
      `MSI version mismatch: expected ${expectedWixVersion}, found ${wixVersion ?? "not found"}`
    );
  }
}

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(wixUpgradeCode ?? "")) {
  errors.push("bundle.windows.wix.upgradeCode must be a stable UUID.");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Morf version OK: ${packageVersion}; MSI: ${wixVersion}`);
