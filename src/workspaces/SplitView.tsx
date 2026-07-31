import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  FolderOpen,
  Grid3X3,
  Scissors,
  TimerReset
} from "lucide-react";
import { DropZone } from "../components/DropZone";
import { EngineBadge } from "../components/EngineBadge";
import { FileQueue } from "../components/FileQueue";
import { useFileQueue } from "../hooks/useFileQueue";
import { pickFolder, revealPath, splitFile } from "../lib/backend";
import { makeRecord } from "../lib/history";
import type { EngineInfo, OperationRecord, SplitRequest } from "../types";

export function SplitView({
  engines,
  onRecord
}: {
  engines: EngineInfo[];
  onRecord: (record: OperationRecord) => void;
}) {
  const queue = useFileQueue();
  const [outputDir, setOutputDir] = useState("");
  const [mode, setMode] = useState<SplitRequest["mode"]>("pages");
  const [targetFormat, setTargetFormat] = useState("pdf");
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(2);
  const [pagesPerFile, setPagesPerFile] = useState(1);
  const [segmentSeconds, setSegmentSeconds] = useState(60);
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(90);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(
    null
  );

  const file = queue.files[0];
  const sourceKind = file?.kind;

  const actualMode = useMemo<SplitRequest["mode"]>(() => {
    if (sourceKind === "image") return "tiles";
    if (sourceKind === "video" || sourceKind === "audio") return "duration";
    if (sourceKind === "pdf") return mode === "render" ? "render" : "pages";
    return mode;
  }, [mode, sourceKind]);

  const engineId =
    sourceKind === "image"
      ? ["avif", "heic", "heif", "svg"].includes(file?.extension ?? "")
        ? "ffmpeg"
        : "native"
      : sourceKind === "video" || sourceKind === "audio"
        ? "ffmpeg"
        : actualMode === "render"
          ? "poppler"
          : "qpdf";
  const engine = engines.find((item) => item.id === engineId);
  const canRun = engineId === "native" || Boolean(engine?.installed);

  const addSingle = async (paths: string[]) => {
    queue.clear();
    await queue.addPaths(paths.slice(0, 1));
    setMessage(null);
  };

  const chooseOutput = async () => {
    const folder = await pickFolder();
    if (folder) setOutputDir(folder);
    return folder;
  };

  const run = async () => {
    setMessage(null);
    if (!file) return;
    const destination = outputDir || (await chooseOutput());
    if (!destination) return;
    if (!canRun) {
      setMessage({ kind: "error", text: `Для этой операции нужен ${engine?.name}.` });
      return;
    }
    setWorking(true);
    queue.patch(file.id, { status: "working" });
    try {
      const effectiveTarget =
        sourceKind === "image"
          ? file.extension || "png"
          : sourceKind === "video" || sourceKind === "audio"
            ? file.extension
            : actualMode === "pages"
              ? "pdf"
              : targetFormat;
      const result = await splitFile({
        input: file.path,
        outputDir: destination,
        mode: actualMode,
        targetFormat: effectiveTarget,
        rows,
        columns,
        pagesPerFile,
        segmentSeconds,
        dpi,
        quality
      });
      const success = result.items.every((item) => item.success);
      const outputs = result.items.flatMap((item) => (item.output ? [item.output] : []));
      queue.patch(file.id, {
        status: success ? "done" : "error",
        error: success ? undefined : result.items.find((item) => !item.success)?.message
      });
      setMessage({
        kind: success ? "success" : "error",
        text: success
          ? `Создано частей: ${outputs.length}.`
          : "Не все части удалось создать."
      });
      onRecord(
        makeRecord(
          "split",
          "Разделение файла",
          `${file.name} · ${outputs.length} частей`,
          outputs,
          success
        )
      );
    } catch (error) {
      queue.patch(file.id, { status: "error", error: String(error) });
      setMessage({ kind: "error", text: String(error) });
    } finally {
      setWorking(false);
    }
  };

  const supported = ["image", "video", "audio", "pdf"].includes(sourceKind ?? "");

  return (
    <div className="workspace-grid">
      <main className="workspace-main">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">Из одного — несколько</span>
            <h1>Разделить файл</h1>
            <p>Страницы PDF, сетка изображения или временные отрезки медиа.</p>
          </div>
          {file && <DropZone onPaths={addSingle} compact multiple={false} label="Заменить" />}
        </header>

        {!file ? (
          <DropZone
            onPaths={addSingle}
            multiple={false}
            busy={queue.isAdding}
            label="Выберите один файл"
          />
        ) : (
          <>
            <FileQueue files={queue.files} onRemove={queue.remove} />
            {!supported && (
              <div className="inline-notice warning">
                Этот тип пока нельзя разделить напрямую. Сначала конвертируйте его в PDF.
              </div>
            )}

            {sourceKind === "image" && (
              <section className="split-preview">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">Сетка</span>
                    <h2>
                      {rows} × {columns} · {rows * columns} частей
                    </h2>
                  </div>
                </div>
                <div
                  className="tile-preview"
                  style={{
                    gridTemplateColumns: `repeat(${columns}, 1fr)`,
                    gridTemplateRows: `repeat(${rows}, 1fr)`
                  }}
                >
                  {Array.from({ length: rows * columns }, (_, index) => (
                    <span key={index}>{index + 1}</span>
                  ))}
                </div>
              </section>
            )}

            {(sourceKind === "video" || sourceKind === "audio") && (
              <section className="timeline-preview">
                <div className="timeline-ruler">
                  {Array.from({ length: 5 }, (_, index) => (
                    <span key={index} />
                  ))}
                </div>
                <div className="timeline-copy">
                  <TimerReset size={18} />
                  Новый файл каждые <strong>{segmentSeconds} сек.</strong>
                </div>
              </section>
            )}

            {message && (
              <div className={`result-banner ${message.kind}`}>
                {message.kind === "success" ? <Check size={18} /> : <Scissors size={18} />}
                <span>{message.text}</span>
                {message.kind === "success" && outputDir && (
                  <button type="button" onClick={() => void revealPath(outputDir)}>
                    Показать
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <aside className="inspector">
        <div className="inspector-header">
          <div>
            <span className="eyebrow">Разбиение</span>
            <h2>Параметры</h2>
          </div>
          <Scissors size={20} />
        </div>

        {sourceKind === "pdf" && (
          <>
            <label className="field">
              <span>Что получить</span>
              <div className="segmented">
                <button
                  type="button"
                  className={actualMode === "pages" ? "active" : ""}
                  onClick={() => {
                    setMode("pages");
                    setTargetFormat("pdf");
                  }}
                >
                  PDF
                </button>
                <button
                  type="button"
                  className={actualMode === "render" ? "active" : ""}
                  onClick={() => {
                    setMode("render");
                    setTargetFormat("png");
                  }}
                >
                  Картинки
                </button>
              </div>
            </label>
            {actualMode === "pages" ? (
              <label className="field">
                <span>Страниц в одном файле</span>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={pagesPerFile}
                  onChange={(event) => setPagesPerFile(Number(event.target.value))}
                />
              </label>
            ) : (
              <>
                <label className="field">
                  <span>Формат страниц</span>
                  <div className="select-wrap">
                    <select
                      value={targetFormat}
                      onChange={(event) => setTargetFormat(event.target.value)}
                    >
                      <option value="png">PNG</option>
                      <option value="jpg">JPEG</option>
                      <option value="txt">Текст TXT</option>
                    </select>
                    <ChevronDown size={15} />
                  </div>
                </label>
                {targetFormat !== "txt" && (
                  <label className="field">
                    <span>Разрешение</span>
                    <select value={dpi} onChange={(event) => setDpi(Number(event.target.value))}>
                      <option value="96">96 dpi</option>
                      <option value="150">150 dpi</option>
                      <option value="220">220 dpi</option>
                      <option value="300">300 dpi</option>
                    </select>
                  </label>
                )}
              </>
            )}
          </>
        )}

        {sourceKind === "image" && (
          <>
            <div className="inspector-section-title">
              <Grid3X3 size={16} />
              Сетка нарезки
            </div>
            <div className="two-fields">
              <label className="field">
                <span>Строки</span>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={rows}
                  onChange={(event) => setRows(Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>Колонки</span>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={columns}
                  onChange={(event) => setColumns(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="control-group">
              <div className="control-heading">
                <span>Качество</span>
                <strong>{quality}%</strong>
              </div>
              <input
                className="range"
                type="range"
                min="30"
                max="100"
                value={quality}
                onChange={(event) => setQuality(Number(event.target.value))}
              />
            </div>
          </>
        )}

        {(sourceKind === "video" || sourceKind === "audio") && (
          <label className="field">
            <span>Длина части, секунд</span>
            <input
              type="number"
              min="1"
              value={segmentSeconds}
              onChange={(event) => setSegmentSeconds(Number(event.target.value))}
            />
          </label>
        )}

        {file && <EngineBadge engine={engine} />}

        <label className="field output-field">
          <span>Папка назначения</span>
          <button className="folder-field" type="button" onClick={() => void chooseOutput()}>
            <FolderOpen size={16} />
            <span title={outputDir}>{outputDir || "Выбрать папку"}</span>
          </button>
        </label>

        <div className="inspector-spacer" />
        <button
          className="button primary wide"
          type="button"
          disabled={!file || !supported || !canRun || working}
          onClick={() => void run()}
        >
          {working ? <span className="button-loader" /> : <Scissors size={18} />}
          {working ? "Разделяем…" : "Разделить"}
        </button>
        {file && !canRun && (
          <p className="inspector-hint">
            Для выбранной операции установите {engine?.name ?? engineId}.
          </p>
        )}
      </aside>
    </div>
  );
}
