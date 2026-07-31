import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookmarkPlus,
  Captions,
  Check,
  ChevronDown,
  Cpu,
  Droplets,
  FolderOpen,
  Gauge,
  ImageDown,
  RotateCw,
  Scissors,
  SlidersHorizontal,
  Trash2,
  WandSparkles
} from "lucide-react";
import { DropZone } from "../components/DropZone";
import { EngineBadge } from "../components/EngineBadge";
import { FileQueue } from "../components/FileQueue";
import { JobProgress } from "../components/JobProgress";
import { JobQueuePanel } from "../components/JobQueuePanel";
import { useBackgroundJob } from "../hooks/useBackgroundJob";
import { useFileQueue } from "../hooks/useFileQueue";
import { getSettings, pickFiles, pickFolder, revealPath } from "../lib/backend";
import {
  FORMAT_GROUPS,
  requiredEngines,
  targetsForKind
} from "../lib/catalog";
import { makeRecord } from "../lib/history";
import { estimateLabel } from "../lib/estimate";
import { createPreset, loadPresets, savePresets } from "../lib/presets";
import type {
  ConversionOptions,
  ConversionPreset,
  EngineInfo,
  OperationRecord
} from "../types";

const initialOptions: ConversionOptions = {
  quality: 88,
  fit: "contain",
  rotation: 0,
  grayscale: false,
  preserveMetadata: false,
  audioBitrate: 192,
  hardwareEncoder: "software",
  watermarkOpacity: 70,
  watermarkScale: 22,
  watermarkPosition: "bottom-right",
  subtitleMode: "off"
};

export function ConvertView({
  engines,
  onRecord,
  incomingPaths = [],
  onConsumeIncoming
}: {
  engines: EngineInfo[];
  onRecord: (record: OperationRecord) => void;
  incomingPaths?: string[];
  onConsumeIncoming?: () => void;
}) {
  const queue = useFileQueue();
  const background = useBackgroundJob();
  const [target, setTarget] = useState("png");
  const [outputDir, setOutputDir] = useState("");
  const [options, setOptions] = useState<ConversionOptions>(initialOptions);
  const [presets, setPresets] = useState<ConversionPreset[]>(loadPresets);
  const [presetId, setPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(
    null
  );
  const handledJob = useRef<string | null>(null);

  const sourceKind = queue.files[0]?.kind;
  const availableTargets = useMemo(
    () => {
      if (!queue.files.length) return targetsForKind();
      const lists = queue.files.map((file) =>
        targetsForKind(file.kind, file.extension)
      );
      const common = lists
        .slice(1)
        .reduce(
          (extensions, formats) =>
            new Set(
              [...extensions].filter((extension) =>
                formats.some((format) => format.extension === extension)
              )
            ),
          new Set(lists[0].map((format) => format.extension))
        );
      return lists[0].filter((format) => common.has(format.extension));
    },
    [queue.files]
  );
  const selectedFormat = availableTargets.find((format) => format.extension === target);
  const engineIds = [
    ...new Set(
      queue.files.length
        ? [
            ...queue.files.flatMap((file) =>
              requiredEngines(file.kind, selectedFormat, file.extension)
            ),
            ...(options.preserveMetadata ? ["exiftool"] : [])
          ]
        : ["native"]
    )
  ];
  const requiredEngineInfo = engineIds
    .filter((id) => id !== "native")
    .map((id) => engines.find((item) => item.id === id))
    .filter((engine): engine is EngineInfo => Boolean(engine));
  const missingEngineIds = engineIds.filter(
    (id) => id !== "native" && !engines.find((item) => item.id === id)?.installed
  );
  const missingEngineNames = missingEngineIds.map(
    (id) => engines.find((item) => item.id === id)?.name ?? id
  );
  const canRun = Boolean(selectedFormat) && missingEngineIds.length === 0;
  const working = background.active;
  const estimate = useMemo(
    () => estimateLabel(queue.files, target, options),
    [options, queue.files, target]
  );

  useEffect(() => {
    if (!availableTargets.some((format) => format.extension === target)) {
      setTarget(availableTargets[0]?.extension ?? "png");
    }
  }, [availableTargets, target]);

  useEffect(() => {
    void getSettings().then((value) =>
      setOptions((current) => ({
        ...current,
        hardwareEncoder: value.hardwareEncoder
      }))
    ).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!incomingPaths.length) return;
    void queue.addPaths(incomingPaths).finally(() => onConsumeIncoming?.());
  }, [incomingPaths, onConsumeIncoming, queue.addPaths]);

  useEffect(() => {
    const job = background.job;
    if (!job || handledJob.current === job.id) return;
    if (!["completed", "failed", "cancelled"].includes(job.status)) return;
    handledJob.current = job.id;

    if (job.result) {
      const grouped = new Map<string, typeof job.result.items>();
      for (const item of job.result.items) {
        grouped.set(item.input, [...(grouped.get(item.input) ?? []), item]);
      }
      queue.setFiles((current) =>
        current.map((file) => {
          const items = grouped.get(file.path) ?? [];
          const success = items.length > 0 && items.every((item) => item.success);
          return {
            ...file,
            status: success ? "done" : "error",
            error: success
              ? undefined
              : items.find((item) => !item.success)?.message ?? "Не удалось обработать файл"
          };
        })
      );
      const outputs = job.result.items.flatMap((item) => (item.output ? [item.output] : []));
      const successes = job.result.items.filter((item) => item.success).length;
      const success = job.result.items.every((item) => item.success);
      setMessage({
        kind: success ? "success" : "error",
        text: success
          ? `Готово: сохранено результатов — ${outputs.length}.`
          : `Успешно ${successes} из ${job.result.items.length}. Ошибки показаны в очереди.`
      });
      onRecord(
        makeRecord(
          "convert",
          `Конвертация в ${target.toUpperCase()}`,
          `${queue.files.length} файлов · качество ${options.quality}%`,
          outputs,
          success
        )
      );
      return;
    }

    if (job.status === "cancelled") {
      queue.markAll({ status: "ready", error: undefined });
      setMessage({ kind: "error", text: "Задача отменена. Уже созданные файлы не удалялись." });
    } else {
      queue.markAll({ status: "error", error: job.message ?? "Задача завершилась ошибкой" });
      setMessage({ kind: "error", text: job.message ?? "Задача завершилась ошибкой." });
    }
  }, [background.job, onRecord, options.quality, queue, target]);

  const setOption = <Key extends keyof ConversionOptions>(
    key: Key,
    value: ConversionOptions[Key]
  ) => setOptions((current) => ({ ...current, [key]: value }));

  const chooseOutput = async () => {
    const folder = await pickFolder();
    if (folder) setOutputDir(folder);
    return folder;
  };

  const chooseAuxiliary = async (key: "watermarkPath" | "subtitlePath") => {
    const [path] = await pickFiles(false);
    if (path) setOption(key, path);
  };

  const applyPreset = (id: string) => {
    setPresetId(id);
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    setTarget(preset.targetFormat);
    setOptions({ ...preset.options });
  };

  const storePreset = () => {
    const preset = createPreset(presetName, target, options);
    const next = [...presets, preset];
    setPresets(next);
    savePresets(next);
    setPresetName("");
    setPresetId(preset.id);
  };

  const removePreset = () => {
    if (!presetId) return;
    const next = presets.filter((preset) => preset.id !== presetId);
    setPresets(next);
    savePresets(next);
    setPresetId("");
  };

  const run = async () => {
    setMessage(null);
    if (!queue.files.length) {
      setMessage({ kind: "error", text: "Сначала добавьте хотя бы один файл." });
      return;
    }
    if (!selectedFormat) {
      setMessage({
        kind: "error",
        text: "У выбранных файлов нет общего поддерживаемого формата результата."
      });
      return;
    }
    if (!canRun) {
      setMessage({
        kind: "error",
        text: `Для этой операции нужны: ${missingEngineNames.join(", ")}.`
      });
      return;
    }
    const destination = outputDir || (await chooseOutput());
    if (!destination) return;

    queue.markAll({ status: "working", error: undefined });
    try {
      handledJob.current = null;
      await background.start({
        inputs: queue.files.map((file) => file.path),
        outputDir: destination,
        targetFormat: target,
        overwrite: false,
        options
      });
    } catch (error) {
      queue.markAll({ status: "error", error: String(error) });
      setMessage({ kind: "error", text: String(error) });
    }
  };

  const detachCurrentBatch = () => {
    background.reset();
    queue.clear();
    setMessage({
      kind: "success",
      text: "Пачка продолжает выполняться в фоне. Можно собрать следующую."
    });
  };

  const isVisual = sourceKind === "image" || sourceKind === "video";
  const isAudio = sourceKind === "audio" || selectedFormat?.kind === "audio";
  const supportsHardwareEncoding =
    sourceKind === "video" &&
    ["mp4", "mov", "m4v", "mkv"].includes(selectedFormat?.extension ?? "");

  return (
    <div className="workspace-grid">
      <main className="workspace-main">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">Пакетная обработка</span>
            <h1>Конвертация файлов</h1>
            <p>Один формат и набор параметров для всей очереди.</p>
          </div>
          {queue.files.length > 0 && (
            <DropZone onPaths={queue.addPaths} compact busy={queue.isAdding} />
          )}
        </header>

        {queue.files.length === 0 ? (
          <DropZone onPaths={queue.addPaths} busy={queue.isAdding} />
        ) : (
          <FileQueue files={queue.files} onRemove={queue.remove} onClear={queue.clear} />
        )}

        {background.job && (
          <div className="foreground-job">
            <JobProgress
              job={background.job}
              onPause={() => void background.pause()}
              onResume={() => void background.resume()}
              onCancel={() => void background.cancel()}
            />
            {background.active && (
              <button
                className="button secondary detach-job"
                type="button"
                onClick={detachCurrentBatch}
              >
                Собрать следующую пачку
              </button>
            )}
          </div>
        )}

        <JobQueuePanel excludeId={background.job?.id} />

        {message && (
          <div className={`result-banner ${message.kind}`}>
            {message.kind === "success" ? <Check size={18} /> : <WandSparkles size={18} />}
            <span>{message.text}</span>
            {message.kind === "success" && outputDir && (
              <button type="button" onClick={() => void revealPath(outputDir)}>
                Показать
              </button>
            )}
          </div>
        )}
      </main>

      <aside className="inspector">
        <div className="inspector-header">
          <div>
            <span className="eyebrow">Результат</span>
            <h2>Настройки</h2>
          </div>
          <SlidersHorizontal size={20} />
        </div>

        <div className="preset-panel">
          <label className="field">
            <span>Сохранённый пресет</span>
            <div className="preset-select-row">
              <div className="select-wrap">
                <select value={presetId} onChange={(event) => applyPreset(event.target.value)}>
                  <option value="">Не выбран</option>
                  {presets.map((preset) => (
                    <option value={preset.id} key={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </div>
              <button
                className="icon-button"
                type="button"
                disabled={!presetId}
                onClick={removePreset}
                aria-label="Удалить пресет"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </label>
          <div className="preset-save-row">
            <input
              type="text"
              value={presetName}
              placeholder="Название нового пресета"
              onChange={(event) => setPresetName(event.target.value)}
            />
            <button type="button" onClick={storePreset} aria-label="Сохранить пресет">
              <BookmarkPlus size={15} />
            </button>
          </div>
        </div>

        <label className="field">
          <span>Формат</span>
          <div className="select-wrap">
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              {FORMAT_GROUPS.map((group) => {
                const formats = group.formats.filter((format) =>
                  availableTargets.some(
                    (available) =>
                      available.extension === format.extension && available.kind === format.kind
                  )
                );
                if (!formats.length) return null;
                return (
                  <optgroup label={group.label} key={group.id}>
                    {formats.map((format) => (
                      <option value={format.extension} key={`${group.id}-${format.extension}`}>
                        {format.label} (.{format.extension})
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <ChevronDown size={15} />
          </div>
        </label>

        <div className="engine-badge-stack">
          {requiredEngineInfo.length ? (
            requiredEngineInfo.map((engine) => (
              <EngineBadge engine={engine} key={engine.id} />
            ))
          ) : (
            <EngineBadge engine={engines.find((engine) => engine.id === "native")} />
          )}
        </div>

        {(isVisual || isAudio) && (
          <div className="control-group">
            <div className="control-heading">
              <span>
                <Gauge size={15} />
                Качество
              </span>
              <strong>{options.quality}%</strong>
            </div>
            <input
              className="range"
              type="range"
              min="20"
              max="100"
              value={options.quality}
              onChange={(event) => setOption("quality", Number(event.target.value))}
            />
            <div className="range-labels">
              <span>меньше файл</span>
              <span>лучше качество</span>
            </div>
          </div>
        )}

        {isVisual && (
          <details className="settings-details" open>
            <summary>
              <span>
                <ImageDown size={16} />
                Размер и кадр
              </span>
              <ChevronDown size={15} />
            </summary>
            <div className="details-body">
              <div className="two-fields">
                <label className="field">
                  <span>Ширина, px</span>
                  <input
                    type="number"
                    min="1"
                    placeholder="авто"
                    value={options.width ?? ""}
                    onChange={(event) =>
                      setOption("width", event.target.value ? Number(event.target.value) : undefined)
                    }
                  />
                </label>
                <label className="field">
                  <span>Высота, px</span>
                  <input
                    type="number"
                    min="1"
                    placeholder="авто"
                    value={options.height ?? ""}
                    onChange={(event) =>
                      setOption("height", event.target.value ? Number(event.target.value) : undefined)
                    }
                  />
                </label>
              </div>
              <div className="segmented">
                {(["contain", "cover", "stretch"] as const).map((fit) => (
                  <button
                    className={options.fit === fit ? "active" : ""}
                    type="button"
                    key={fit}
                    onClick={() => setOption("fit", fit)}
                  >
                    {fit === "contain" ? "Вписать" : fit === "cover" ? "Заполнить" : "Растянуть"}
                  </button>
                ))}
              </div>
            </div>
          </details>
        )}

        {(sourceKind === "image" || sourceKind === "video") && (
          <details className="settings-details">
            <summary>
              <span>
                <RotateCw size={16} />
                Быстрая правка
              </span>
              <ChevronDown size={15} />
            </summary>
            <div className="details-body">
              <div className="rotation-buttons">
                {([0, 90, 180, 270] as const).map((rotation) => (
                  <button
                    type="button"
                    className={options.rotation === rotation ? "active" : ""}
                    key={rotation}
                    onClick={() => setOption("rotation", rotation)}
                  >
                    {rotation}°
                  </button>
                ))}
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={options.grayscale}
                  onChange={(event) => setOption("grayscale", event.target.checked)}
                />
                <span>Оттенки серого</span>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={options.preserveMetadata}
                  onChange={(event) =>
                    setOption("preserveMetadata", event.target.checked)
                  }
                />
                <span>Перенести совместимые метаданные через ExifTool</span>
              </label>
            </div>
          </details>
        )}

        {isAudio && (
          <label className="field">
            <span>Битрейт аудио</span>
            <div className="select-wrap">
              <select
                value={options.audioBitrate}
                onChange={(event) => setOption("audioBitrate", Number(event.target.value))}
              >
                {[96, 128, 192, 256, 320].map((bitrate) => (
                  <option value={bitrate} key={bitrate}>
                    {bitrate} кбит/с
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>
          </label>
        )}

        {(sourceKind === "video" || sourceKind === "audio") && (
          <details className="settings-details">
            <summary>
              <span>
                <Scissors size={16} />
                Обрезка по времени
              </span>
              <ChevronDown size={15} />
            </summary>
            <div className="details-body">
              <div className="two-fields">
                <label className="field">
                  <span>Начало, сек</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    value={options.trimStart ?? ""}
                    onChange={(event) =>
                      setOption(
                        "trimStart",
                        event.target.value ? Number(event.target.value) : undefined
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span>Длительность, сек</span>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    placeholder="до конца"
                    value={options.trimDuration ?? ""}
                    onChange={(event) =>
                      setOption(
                        "trimDuration",
                        event.target.value ? Number(event.target.value) : undefined
                      )
                    }
                  />
                </label>
              </div>
              <small className="field-help">
                Пустая длительность сохраняет файл от выбранного начала до конца.
              </small>
            </div>
          </details>
        )}

        {supportsHardwareEncoding && (
          <label className="field">
            <span>
              <Cpu size={14} /> Кодирование видео
            </span>
            <div className="select-wrap">
              <select
                value={options.hardwareEncoder}
                onChange={(event) =>
                  setOption(
                    "hardwareEncoder",
                    event.target.value as ConversionOptions["hardwareEncoder"]
                  )
                }
              >
                <option value="software">Программное (совместимое)</option>
                <option value="auto">Автовыбор + откат</option>
                <option value="nvenc">NVIDIA NVENC</option>
                <option value="videotoolbox">Apple VideoToolbox</option>
                <option value="qsv">Intel Quick Sync</option>
                <option value="amf">AMD AMF</option>
              </select>
              <ChevronDown size={15} />
            </div>
            <small className="field-help">
              Если кодировщик недоступен, Morf автоматически повторит задачу программно.
            </small>
          </label>
        )}

        {isVisual && (
          <details className="settings-details">
            <summary>
              <span>
                <Droplets size={16} />
                Водяной знак
              </span>
              <ChevronDown size={15} />
            </summary>
            <div className="details-body">
              <button
                className="folder-field compact"
                type="button"
                onClick={() => void chooseAuxiliary("watermarkPath")}
              >
                <ImageDown size={15} />
                <span title={options.watermarkPath}>
                  {options.watermarkPath || "Выбрать PNG/JPEG"}
                </span>
              </button>
              {options.watermarkPath && (
                <>
                  <div className="two-fields watermark-fields">
                    <label className="field">
                      <span>Непрозрачность, %</span>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={options.watermarkOpacity}
                        onChange={(event) =>
                          setOption("watermarkOpacity", Number(event.target.value))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Размер, % кадра</span>
                      <input
                        type="number"
                        min="2"
                        max="80"
                        value={options.watermarkScale}
                        onChange={(event) =>
                          setOption("watermarkScale", Number(event.target.value))
                        }
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>Положение</span>
                    <select
                      value={options.watermarkPosition}
                      onChange={(event) =>
                        setOption(
                          "watermarkPosition",
                          event.target.value as ConversionOptions["watermarkPosition"]
                        )
                      }
                    >
                      <option value="top-left">Слева сверху</option>
                      <option value="top-right">Справа сверху</option>
                      <option value="center">По центру</option>
                      <option value="bottom-left">Слева снизу</option>
                      <option value="bottom-right">Справа снизу</option>
                    </select>
                  </label>
                  <button
                    className="text-button danger"
                    type="button"
                    onClick={() => setOption("watermarkPath", undefined)}
                  >
                    <Trash2 size={13} /> Убрать
                  </button>
                </>
              )}
            </div>
          </details>
        )}

        {sourceKind === "video" && selectedFormat?.kind === "video" && (
          <details className="settings-details">
            <summary>
              <span>
                <Captions size={16} />
                Субтитры
              </span>
              <ChevronDown size={15} />
            </summary>
            <div className="details-body">
              <button
                className="folder-field compact"
                type="button"
                onClick={() => void chooseAuxiliary("subtitlePath")}
              >
                <Captions size={15} />
                <span title={options.subtitlePath}>
                  {options.subtitlePath || "Выбрать SRT/VTT/ASS"}
                </span>
              </button>
              <label className="field">
                <span>Режим</span>
                <select
                  value={options.subtitleMode}
                  onChange={(event) =>
                    setOption(
                      "subtitleMode",
                      event.target.value as ConversionOptions["subtitleMode"]
                    )
                  }
                >
                  <option value="off">Не добавлять</option>
                  <option value="mux">Отдельная дорожка</option>
                  <option value="burn">Вшить в изображение</option>
                </select>
              </label>
            </div>
          </details>
        )}

        <label className="field output-field">
          <span>Папка назначения</span>
          <button className="folder-field" type="button" onClick={() => void chooseOutput()}>
            <FolderOpen size={16} />
            <span title={outputDir}>{outputDir || "Выбрать папку"}</span>
          </button>
          <small className="field-help">Прогноз результата: {estimate}</small>
        </label>

        <div className="inspector-spacer" />
        <button
          className="button primary wide"
          type="button"
          disabled={!queue.files.length || working || !canRun}
          onClick={() => void run()}
        >
          {working ? (
            <>
              <span className="button-loader" />
              Обрабатываем…
            </>
          ) : (
            <>
              <WandSparkles size={18} />
              Конвертировать
            </>
          )}
        </button>
        {!selectedFormat && queue.files.length > 0 && (
          <p className="inspector-hint">
            У этих типов файлов нет общего формата. Соберите отдельные пачки.
          </p>
        )}
        {selectedFormat && !canRun && (
          <p className="inspector-hint">
            Установите {missingEngineNames.join(" и ")}, затем обновите список движков.
          </p>
        )}
      </aside>
    </div>
  );
}
