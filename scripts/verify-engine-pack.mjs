import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { basename, delimiter, dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packDirectory = resolve(
  process.env.MORF_ENGINE_PACK_DIR ||
    join(root, "src-tauri", "resources", "engine-pack")
);
const extractionTimeout = 15 * 60_000;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(path, args, options = {}) {
  const isExifToolPerlLauncher =
    process.platform === "win32" && basename(path).toLowerCase() === "exiftool.bat";
  const executable = isExifToolPerlLauncher
    ? join(dirname(path), "..", "Library", "bin", "perl.exe")
    : path;
  const executableArgs = isExifToolPerlLauncher
    ? ["-x", "-S", path, ...args]
    : args;
  const result = spawnSync(executable, executableArgs, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 180_000,
    ...options
  });
  if (result.error) {
    throw new Error(`Не удалось запустить ${path}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `${path} завершился с кодом ${result.status}${detail ? `: ${detail}` : ""}`
    );
  }
  return (result.stdout || result.stderr || "").trim();
}

function runtimeDirectories(environment) {
  return [
    environment,
    join(environment, "bin"),
    join(environment, "Library", "bin"),
    join(environment, "Library", "usr", "bin"),
    join(environment, "Scripts")
  ];
}

async function findExecutable(environment, names) {
  const suffixes =
    process.platform === "win32" ? [".exe", ".com", ".bat", ".cmd", ""] : [""];
  for (const suffix of suffixes) {
    for (const directory of runtimeDirectories(environment)) {
      for (const name of names) {
        const candidate = join(directory, `${name}${suffix}`);
        if (await exists(candidate)) return candidate;
      }
    }
  }
  throw new Error(`Не найден движок ${names.join("/")} в ${environment}`);
}

async function applyBundledEnvironment(environment, target) {
  for (const directory of [
    join(environment, "etc", "conda", "env_vars.d"),
    join(environment, "Library", "etc", "conda", "env_vars.d")
  ]) {
    if (!(await exists(directory))) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
      const values = JSON.parse(await readFile(join(directory, entry.name), "utf8"));
      for (const [name, value] of Object.entries(values)) {
        if (typeof value === "string") target[name] = value;
      }
    }
  }
}

async function main() {
  const manifest = JSON.parse(
    await readFile(join(packDirectory, "manifest.json"), "utf8")
  );
  if (manifest.mode !== "embedded") {
    throw new Error("Проверять можно только embedded-комплект");
  }

  const temporary = await mkdtemp(join(tmpdir(), "morf-engine-check-"));
  try {
    const unpacker = join(packDirectory, manifest.unpacker);
    const environmentArchive = join(packDirectory, manifest.environmentArchive);
    run(unpacker, [environmentArchive], {
      cwd: temporary,
      stdio: "inherit",
      timeout: extractionTimeout
    });

    const environment = join(temporary, "env");
    const pathEntries = runtimeDirectories(environment);
    const childEnvironment = {
      ...process.env,
      CONDA_PREFIX: environment,
      PATH: [...pathEntries, process.env.PATH || ""].join(delimiter)
    };
    await applyBundledEnvironment(environment, childEnvironment);
    for (const tessdata of [
      join(environment, "share", "tessdata"),
      join(environment, "Library", "share", "tessdata")
    ]) {
      if (await exists(tessdata)) {
        childEnvironment.TESSDATA_PREFIX = tessdata;
        break;
      }
    }

    const engines = [
      ["FFmpeg", ["ffmpeg"], ["-version"]],
      ["Pandoc", ["pandoc"], ["--version"]],
      ["qpdf", ["qpdf"], ["--version"]],
      ["Poppler", ["pdftoppm"], ["-v"]],
      ["Tesseract OCR", ["tesseract"], ["--version"]],
      ["ExifTool", ["exiftool"], ["-ver"]],
      ["7-Zip", ["7z", "7zz"], ["-h"]]
    ];
    for (const [label, names, versionArgs] of engines) {
      const executable = await findExecutable(environment, names);
      const version = run(executable, versionArgs, { env: childEnvironment });
      console.log(`${label}: ${version.split(/\r?\n/, 1)[0] || "OK"}`);
    }
    const tesseract = await findExecutable(environment, ["tesseract"]);
    const languages = run(tesseract, ["--list-langs"], { env: childEnvironment });
    for (const language of ["eng", "rus"]) {
      if (!languages.split(/\s+/).includes(language)) {
        throw new Error(`В комплекте Tesseract отсутствует язык ${language}`);
      }
    }
    console.log("Tesseract languages: eng, rus");

    const libreOfficeRoot = join(temporary, "libreoffice");
    await mkdir(libreOfficeRoot, { recursive: true });
    const libreOfficeArchive = join(packDirectory, manifest.libreofficeArchive);
    run(
      "tar",
      ["-xzf", basename(libreOfficeArchive), "-C", libreOfficeRoot],
      {
        cwd: dirname(libreOfficeArchive),
        stdio: "inherit",
        timeout: extractionTimeout
      }
    );
    const libreOffice = join(
      libreOfficeRoot,
      ...manifest.libreofficeExecutable.split("/")
    );
    if (!(await exists(libreOffice))) {
      throw new Error(`LibreOffice не найден после распаковки: ${libreOffice}`);
    }
    const libreOfficeProfile = join(temporary, "libreoffice-profile");
    await mkdir(libreOfficeProfile, { recursive: true });
    const profileUrl = pathToFileURL(`${libreOfficeProfile}${sep}`).href;
    const libreOfficeVersion = run(
      libreOffice,
      [
        `-env:UserInstallation=${profileUrl}`,
        "--headless",
        "--nologo",
        "--nodefault",
        "--nofirststartwizard",
        "--version"
      ],
      { env: childEnvironment, timeout: 5 * 60_000 }
    );
    console.log(
      `LibreOffice: ${libreOfficeVersion.split(/\r?\n/, 1)[0] || "OK"}`
    );
    console.log(`Engine pack verified: ${manifest.bundleVersion}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
