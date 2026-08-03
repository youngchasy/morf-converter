import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Check,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileSearch,
  FolderOpen,
  Settings2,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import {
  createArchive,
  extractArchive,
  getEngineInstallPlans,
  getSettings,
  openExternalUrl,
  pickFiles,
  pickFolder,
  pickOutputFile,
  readMetadata,
  revealPath,
  runOcr,
  saveSettings,
  stripMetadataCopy
} from "../lib/backend";
import type {
  AppSettings,
  EngineInfo,
  EngineInstallPlan
} from "../types";

type Notice = { kind: "success" | "error"; text: string };

function PathButton({
  value,
  label,
  onClick
}: {
  value?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="folder-field compact" type="button" onClick={onClick}>
      <FolderOpen size={15} />
      <span title={value}>{value || label}</span>
    </button>
  );
}

export function AdvancedTools({
  engines,
  onRefresh
}: {
  engines: EngineInfo[];
  onRefresh: () => void;
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [plans, setPlans] = useState<EngineInstallPlan[]>([]);
  const [settingsNotice, setSettingsNotice] = useState<Notice | null>(null);

  const [ocrInput, setOcrInput] = useState("");
  const [ocrOutput, setOcrOutput] = useState("");
  const [ocrLanguage, setOcrLanguage] = useState("rus+eng");
  const [ocrFormat, setOcrFormat] = useState<"txt" | "pdf">("txt");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrNotice, setOcrNotice] = useState<Notice | null>(null);

  const [archiveInputs, setArchiveInputs] = useState<string[]>([]);
  const [archiveFormat, setArchiveFormat] = useState<"zip" | "7z">("zip");
  const [archiveOutput, setArchiveOutput] = useState("");
  const [extractInput, setExtractInput] = useState("");
  const [extractOutput, setExtractOutput] = useState("");
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveNotice, setArchiveNotice] = useState<Notice | null>(null);

  const [metadataInput, setMetadataInput] = useState("");
  const [metadata, setMetadata] = useState("");
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [metadataNotice, setMetadataNotice] = useState<Notice | null>(null);

  useEffect(() => {
    Promise.all([getSettings(), getEngineInstallPlans()])
      .then(([nextSettings, nextPlans]) => {
        setSettings(nextSettings);
        setPlans(nextPlans);
      })
      .catch((error) =>
        setSettingsNotice({ kind: "error", text: String(error) })
      );
  }, []);

  const configurableEngines = useMemo(
    () => engines.filter((engine) => engine.id !== "native"),
    [engines]
  );
  const missingPlans = useMemo(
    () =>
      plans.filter(
        (plan) => !engines.find((engine) => engine.id === plan.engineId)?.installed
      ),
    [engines, plans]
  );

  const chooseOne = async (setter: (path: string) => void) => {
    const [path] = await pickFiles(false);
    if (path) setter(path);
  };

  const saveEngineSettings = async () => {
    if (!settings) return;
    setSettingsNotice(null);
    try {
      const saved = await saveSettings(settings);
      setSettings(saved);
      setSettingsNotice({ kind: "success", text: "Настройки сохранены." });
      onRefresh();
    } catch (error) {
      setSettingsNotice({ kind: "error", text: String(error) });
    }
  };

  const recognize = async () => {
    if (!ocrInput) {
      setOcrNotice({ kind: "error", text: "Выберите изображение или PDF." });
      return;
    }
    const output = ocrOutput || (await pickFolder());
    if (!output) return;
    setOcrOutput(output);
    setOcrBusy(true);
    setOcrNotice(null);
    try {
      const result = await runOcr({
        input: ocrInput,
        outputDir: output,
        language: ocrLanguage,
        outputFormat: ocrFormat
      });
      setOcrNotice({ kind: "success", text: `Готово: ${result}` });
    } catch (error) {
      setOcrNotice({ kind: "error", text: String(error) });
    } finally {
      setOcrBusy(false);
    }
  };

  const buildArchive = async () => {
    if (!archiveInputs.length) {
      setArchiveNotice({ kind: "error", text: "Добавьте файлы в архив." });
      return;
    }
    const output =
      archiveOutput ||
      (await pickOutputFile(
        `morf-archive.${archiveFormat}`,
        archiveFormat.toUpperCase(),
        [archiveFormat]
      ));
    if (!output) return;
    setArchiveOutput(output);
    setArchiveBusy(true);
    setArchiveNotice(null);
    try {
      const result = await createArchive({
        inputs: archiveInputs,
        outputPath: output,
        format: archiveFormat
      });
      setArchiveNotice({ kind: "success", text: `Архив создан: ${result}` });
    } catch (error) {
      setArchiveNotice({ kind: "error", text: String(error) });
    } finally {
      setArchiveBusy(false);
    }
  };

  const unpackArchive = async () => {
    if (!extractInput) {
      setArchiveNotice({ kind: "error", text: "Выберите архив." });
      return;
    }
    const output = extractOutput || (await pickFolder());
    if (!output) return;
    setExtractOutput(output);
    setArchiveBusy(true);
    setArchiveNotice(null);
    try {
      const files = await extractArchive({ input: extractInput, outputDir: output });
      setArchiveNotice({
        kind: "success",
        text: `Распаковано файлов: ${files.length}.`
      });
    } catch (error) {
      setArchiveNotice({ kind: "error", text: String(error) });
    } finally {
      setArchiveBusy(false);
    }
  };

  const inspectMetadata = async () => {
    if (!metadataInput) return;
    setMetadataBusy(true);
    setMetadataNotice(null);
    try {
      setMetadata(JSON.stringify(await readMetadata(metadataInput), null, 2));
    } catch (error) {
      setMetadataNotice({ kind: "error", text: String(error) });
    } finally {
      setMetadataBusy(false);
    }
  };

  const cleanMetadata = async () => {
    if (!metadataInput) return;
    const output = await pickFolder();
    if (!output) return;
    setMetadataBusy(true);
    try {
      const result = await stripMetadataCopy(metadataInput, output);
      setMetadataNotice({ kind: "success", text: `Чистая копия: ${result}` });
    } catch (error) {
      setMetadataNotice({ kind: "error", text: String(error) });
    } finally {
      setMetadataBusy(false);
    }
  };

  return (
    <>
      <section className="advanced-tools-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Alpha 0.1</span>
            <h2>Расширенные операции</h2>
          </div>
          <span className="readiness">локально, без загрузки в облако</span>
        </div>

        <div className="advanced-tool-grid">
          <article className="tool-panel">
            <div className="tool-panel-head">
              <span className="quick-icon blue"><FileSearch size={20} /></span>
              <div>
                <strong>OCR</strong>
                <small>Изображение или PDF → TXT / searchable PDF</small>
              </div>
            </div>
            <PathButton
              value={ocrInput}
              label="Выбрать изображение или PDF"
              onClick={() => void chooseOne(setOcrInput)}
            />
            <div className="two-fields">
              <label className="field">
                <span>Языки</span>
                <input
                  type="text"
                  value={ocrLanguage}
                  onChange={(event) => setOcrLanguage(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Результат</span>
                <select
                  value={ocrFormat}
                  onChange={(event) => setOcrFormat(event.target.value as "txt" | "pdf")}
                >
                  <option value="txt">TXT</option>
                  <option value="pdf">PDF с текстовым слоем</option>
                </select>
              </label>
            </div>
            <PathButton
              value={ocrOutput}
              label="Папка результата"
              onClick={async () => setOcrOutput((await pickFolder()) ?? ocrOutput)}
            />
            <button
              className="button primary wide"
              type="button"
              disabled={ocrBusy}
              onClick={() => void recognize()}
            >
              {ocrBusy ? <span className="button-loader" /> : <Sparkles size={16} />}
              Распознать
            </button>
            {ocrNotice && <p className={`tool-notice ${ocrNotice.kind}`}>{ocrNotice.text}</p>}
          </article>

          <article className="tool-panel">
            <div className="tool-panel-head">
              <span className="quick-icon sand"><Archive size={20} /></span>
              <div>
                <strong>Архивы</strong>
                <small>ZIP встроен; 7Z/RAR/TAR через 7-Zip</small>
              </div>
            </div>
            <button
              className="folder-field compact"
              type="button"
              onClick={async () => setArchiveInputs(await pickFiles(true))}
            >
              <Archive size={15} />
              <span>
                {archiveInputs.length
                  ? `Выбрано файлов: ${archiveInputs.length}`
                  : "Файлы для нового архива"}
              </span>
            </button>
            <div className="two-fields archive-actions">
              <label className="field">
                <span>Формат</span>
                <select
                  value={archiveFormat}
                  onChange={(event) => {
                    setArchiveFormat(event.target.value as "zip" | "7z");
                    setArchiveOutput("");
                  }}
                >
                  <option value="zip">ZIP</option>
                  <option value="7z">7Z</option>
                </select>
              </label>
              <button
                className="button secondary"
                type="button"
                disabled={archiveBusy}
                onClick={() => void buildArchive()}
              >
                Создать
              </button>
            </div>
            <div className="tool-divider" />
            <PathButton
              value={extractInput}
              label="Архив для распаковки"
              onClick={() => void chooseOne(setExtractInput)}
            />
            <button
              className="button secondary wide"
              type="button"
              disabled={archiveBusy}
              onClick={() => void unpackArchive()}
            >
              <Download size={16} /> Распаковать
            </button>
            {archiveNotice && (
              <p className={`tool-notice ${archiveNotice.kind}`}>{archiveNotice.text}</p>
            )}
          </article>

          <article className="tool-panel">
            <div className="tool-panel-head">
              <span className="quick-icon mint"><ShieldCheck size={20} /></span>
              <div>
                <strong>Метаданные</strong>
                <small>EXIF, XMP, GPS и безопасная очищенная копия</small>
              </div>
            </div>
            <PathButton
              value={metadataInput}
              label="Выбрать файл"
              onClick={() => void chooseOne(setMetadataInput)}
            />
            <div className="tool-button-row">
              <button
                className="button secondary"
                type="button"
                disabled={!metadataInput || metadataBusy}
                onClick={() => void inspectMetadata()}
              >
                <Database size={15} /> Показать
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={!metadataInput || metadataBusy}
                onClick={() => void cleanMetadata()}
              >
                <ShieldCheck size={15} /> Чистая копия
              </button>
            </div>
            {metadata && <pre className="metadata-preview">{metadata}</pre>}
            {metadataNotice && (
              <p className={`tool-notice ${metadataNotice.kind}`}>{metadataNotice.text}</p>
            )}
          </article>
        </div>
      </section>

      <section className="settings-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Система</span>
            <h2>Пути и нагрузка</h2>
          </div>
          <Settings2 size={19} />
        </div>

        {settings && (
          <div className="settings-layout">
            <div className="settings-card">
              <div className="two-fields">
                <label className="field">
                  <span>Параллельных задач</span>
                  <input
                    type="number"
                    min="1"
                    max="8"
                    value={settings.maxParallelJobs}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        maxParallelJobs: Number(event.target.value)
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Кодировщик по умолчанию</span>
                  <select
                    value={settings.hardwareEncoder}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        hardwareEncoder: event.target
                          .value as AppSettings["hardwareEncoder"]
                      })
                    }
                  >
                    <option value="software">Программный</option>
                    <option value="auto">Автовыбор</option>
                    <option value="nvenc">NVENC</option>
                    <option value="videotoolbox">VideoToolbox</option>
                    <option value="qsv">Quick Sync</option>
                    <option value="amf">AMD AMF</option>
                  </select>
                </label>
              </div>
              <div className="engine-path-list">
                {configurableEngines.map((engine) => (
                  <label className="engine-path-row" key={engine.id}>
                    <span>
                      <strong>{engine.name}</strong>
                      <small>{engine.path || "автопоиск"}</small>
                    </span>
                    <input
                      type="text"
                      value={settings.enginePaths[engine.id] ?? ""}
                      placeholder="Автоматически"
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          enginePaths: {
                            ...settings.enginePaths,
                            [engine.id]: event.target.value
                          }
                        })
                      }
                    />
                    <button
                      className="icon-button"
                      type="button"
                      onClick={async () => {
                        const [path] = await pickFiles(false);
                        if (!path) return;
                        setSettings({
                          ...settings,
                          enginePaths: { ...settings.enginePaths, [engine.id]: path }
                        });
                      }}
                      aria-label={`Выбрать ${engine.name}`}
                    >
                      <FolderOpen size={14} />
                    </button>
                  </label>
                ))}
              </div>
              <button
                className="button primary"
                type="button"
                onClick={() => void saveEngineSettings()}
              >
                <Check size={16} /> Сохранить настройки
              </button>
              {settingsNotice && (
                <p className={`tool-notice ${settingsNotice.kind}`}>
                  {settingsNotice.text}
                </p>
              )}
            </div>

            <div className="settings-side">
              <article className="install-card">
                <strong>
                  {missingPlans.length ? "Резервная установка" : "Встроенный комплект готов"}
                </strong>
                <p>
                  {missingPlans.length
                    ? "Если встроенная копия повреждена, можно временно подключить системную установку."
                    : "Все восемь внешних движков входят в полную версию Morf и работают локально."}
                </p>
                {missingPlans.map((plan) => (
                    <details key={plan.engineId}>
                      <summary>{plan.title}</summary>
                      <code>{plan.command}</code>
                      <div className="tool-button-row">
                        <button
                          className="button secondary small"
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(plan.command)}
                        >
                          <Copy size={13} /> Копировать
                        </button>
                        <button
                          className="button secondary small"
                          type="button"
                          onClick={() => void openExternalUrl(plan.website)}
                        >
                          <ExternalLink size={13} /> Сайт
                        </button>
                      </div>
                    </details>
                  ))}
              </article>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
