import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { delimiter, dirname, extname, basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(
  process.env.MORF_ENGINE_OUTPUT_DIRECTORY ||
    join(root, "src-tauri", "resources", "engine-pack")
);
const environmentSource = resolve(
  process.env.MORF_ENGINE_ENVIRONMENT_ARCHIVE || join(root, "environment.tar")
);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function executableNames(name) {
  if (process.platform !== "win32") return [name];
  return extname(name) ? [name] : [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name];
}

async function findOnPath(name) {
  for (const directory of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    for (const candidate of executableNames(name)) {
      const path = join(directory, candidate);
      if (await exists(path)) return path;
    }
  }
  throw new Error(`${name} не найден в PATH`);
}

async function locateStandaloneUnpacker() {
  if (process.env.MORF_PIXI_UNPACK) {
    const candidate = resolve(process.env.MORF_PIXI_UNPACK);
    if (await exists(candidate)) return candidate;
    throw new Error(`Standalone pixi-unpack не найден: ${candidate}`);
  }

  const candidate = await findOnPath("pixi-unpack");
  const trampolineConfiguration = join(
    dirname(candidate),
    "trampoline_configuration",
    "pixi-unpack.json"
  );
  if (await exists(trampolineConfiguration)) {
    throw new Error(
      "В PATH найден Pixi-трамплин вместо standalone pixi-unpack. " +
        "Задайте MORF_PIXI_UNPACK с путём к отдельному бинарнику из релиза pixi-pack."
    );
  }
  return candidate;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function locateLibreOffice() {
  if (process.env.MORF_LIBREOFFICE_DIR) {
    return resolve(process.env.MORF_LIBREOFFICE_DIR);
  }
  const candidates =
    process.platform === "win32"
      ? [
          join(process.env.ProgramFiles || "C:\\Program Files", "LibreOffice"),
          join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "LibreOffice")
        ]
      : process.platform === "darwin"
        ? ["/Applications/LibreOffice.app"]
        : ["/usr/lib/libreoffice", "/opt/libreoffice"];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error(
    "LibreOffice не найден. Установите его в CI или задайте MORF_LIBREOFFICE_DIR."
  );
}

function libreOfficeExecutable(directory) {
  const folder = basename(directory);
  if (process.platform === "win32") return `${folder}/program/soffice.com`;
  if (process.platform === "darwin") {
    return `${folder}/Contents/MacOS/soffice`;
  }
  return `${folder}/program/soffice`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} завершился с кодом ${result.status}`);
  }
}

async function main() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const platform = process.env.MORF_ENGINE_PLATFORM || process.platform;
  const architecture = process.env.MORF_ENGINE_ARCH || process.arch;
  const libreOfficeDirectory = await locateLibreOffice();
  const expectedLibreOfficeExecutable = join(
    dirname(libreOfficeDirectory),
    ...libreOfficeExecutable(libreOfficeDirectory).split("/")
  );

  if (!(await exists(environmentSource))) {
    throw new Error(`Архив окружения не найден: ${environmentSource}`);
  }
  if (!(await exists(expectedLibreOfficeExecutable))) {
    throw new Error(`soffice не найден: ${expectedLibreOfficeExecutable}`);
  }

  await mkdir(outputDirectory, { recursive: true });
  const environmentTarget = join(outputDirectory, "environment.tar");
  const libreOfficeTarget = join(outputDirectory, "libreoffice.tar.gz");
  const unpackerSource = await locateStandaloneUnpacker();
  const unpackerName = process.platform === "win32" ? "pixi-unpack.exe" : "pixi-unpack";
  const unpackerTarget = join(outputDirectory, unpackerName);

  for (const path of [environmentTarget, libreOfficeTarget, unpackerTarget]) {
    await rm(path, { force: true });
  }
  await copyFile(environmentSource, environmentTarget);
  await copyFile(unpackerSource, unpackerTarget);
  await copyFile(join(root, "pixi.toml"), join(outputDirectory, "pixi.toml"));
  if (await exists(join(root, "pixi.lock"))) {
    await copyFile(join(root, "pixi.lock"), join(outputDirectory, "pixi.lock"));
  }
  if (process.platform !== "win32") await chmod(unpackerTarget, 0o755);
  if (process.platform === "darwin") {
    run("codesign", ["--force", "--sign", "-", unpackerTarget]);
  }

  run(
    "tar",
    [
      "-czf",
      basename(libreOfficeTarget),
      "-C",
      dirname(libreOfficeDirectory),
      basename(libreOfficeDirectory)
    ],
    { cwd: outputDirectory }
  );

  const manifest = {
    schema: 1,
    mode: "embedded",
    bundleVersion: `${packageJson.version}-engines.1-${platform}-${architecture}`,
    platform,
    architecture,
    environmentArchive: "environment.tar",
    environmentSha256: await sha256(environmentTarget),
    unpacker: unpackerName,
    libreofficeArchive: "libreoffice.tar.gz",
    libreofficeSha256: await sha256(libreOfficeTarget),
    libreofficeExecutable: libreOfficeExecutable(libreOfficeDirectory)
  };
  await writeFile(
    join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  const environmentSize = (await stat(environmentTarget)).size;
  const libreOfficeSize = (await stat(libreOfficeTarget)).size;
  console.log(
    `Engine pack staged: ${manifest.bundleVersion} (${Math.round(
      (environmentSize + libreOfficeSize) / 1024 / 1024
    )} MiB)`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
