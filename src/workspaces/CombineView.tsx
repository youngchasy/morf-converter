import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CopyPlus,
  FileOutput,
  GripVertical,
  Layers3,
  RotateCw,
  ScanLine,
  Trash2
} from "lucide-react";
import { DropZone } from "../components/DropZone";
import { EngineBadge } from "../components/EngineBadge";
import { FileThumbnail } from "../components/FileThumbnail";
import {
  combineFiles,
  inspectPaths,
  pickOutputPdf,
  revealPath
} from "../lib/backend";
import { makeRecord } from "../lib/history";
import type {
  CombineItem,
  EngineInfo,
  OperationRecord,
  WorkFile
} from "../types";

function toCombineItem(file: WorkFile): CombineItem {
  return {
    id: crypto.randomUUID(),
    path: file.path,
    name: file.name,
    extension: file.extension,
    kind: file.kind,
    pageRange: "1-z",
    scale: 100,
    rotation: 0,
    margin: 28,
    offsetX: 0,
    offsetY: 0,
    borderWidth: 0,
    borderColor: "#20201e",
    fit: "contain"
  };
}

export function CombineView({
  engines,
  onRecord
}: {
  engines: EngineInfo[];
  onRecord: (record: OperationRecord) => void;
}) {
  const [items, setItems] = useState<CombineItem[]>([]);
  const [sourceFiles, setSourceFiles] = useState<Record<string, WorkFile>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [outputPath, setOutputPath] = useState("");
  const [mode, setMode] = useState<"lossless" | "layout">("layout");
  const [pagePreset, setPagePreset] = useState<"a4" | "letter" | "source">("a4");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [background, setBackground] = useState("#ffffff");
  const [quality, setQuality] = useState(90);
  const [dpi, setDpi] = useState(150);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(
    null
  );
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const hasPdf = items.some((item) => item.kind === "pdf");
  const allPdf = items.length > 0 && items.every((item) => item.kind === "pdf");
  const hasExternalImage = items.some(
    (item) =>
      item.kind === "image" &&
      ["avif", "heic", "heif", "svg"].includes(item.extension)
  );

  useEffect(() => {
    if (!selectedId && items[0]) setSelectedId(items[0].id);
    if (selectedId && !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    }
  }, [items, selectedId]);

  useEffect(() => {
    if (!allPdf && mode === "lossless") setMode("layout");
  }, [allPdf, mode]);

  const engineIds = [
    ...new Set([
      mode === "lossless" ? "qpdf" : hasPdf ? "poppler" : "native",
      ...(hasExternalImage ? ["ffmpeg"] : [])
    ])
  ];
  const requiredEngineInfo = engineIds
    .filter((id) => id !== "native")
    .map((id) => engines.find((engine) => engine.id === id))
    .filter((engine): engine is EngineInfo => Boolean(engine));
  const missingEngineNames = engineIds
    .filter(
      (id) => id !== "native" && !engines.find((engine) => engine.id === id)?.installed
    )
    .map((id) => engines.find((engine) => engine.id === id)?.name ?? id);
  const canRun = missingEngineNames.length === 0;

  const addPaths = async (paths: string[]) => {
    if (!paths.length) return;
    setAdding(true);
    try {
      const inspected = await inspectPaths(paths);
      setSourceFiles((current) => {
        const next = { ...current };
        for (const file of inspected) next[file.path] = file;
        return next;
      });
      setItems((current) => {
        const known = new Set(current.map((item) => item.path.toLocaleLowerCase()));
        const additions = inspected
          .filter((file) => ["image", "pdf"].includes(file.kind))
          .filter((file) => !known.has(file.path.toLocaleLowerCase()))
          .map(toCombineItem);
        return [...current, ...additions];
      });
    } catch (error) {
      setMessage({ kind: "error", text: String(error) });
    } finally {
      setAdding(false);
    }
  };

  const patchSelected = (patch: Partial<CombineItem>) => {
    if (!selected) return;
    setItems((current) =>
      current.map((item) => (item.id === selected.id ? { ...item, ...patch } : item))
    );
  };

  const removeItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const move = (id: string, direction: -1 | 1) => {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const duplicate = { ...selected, id: crypto.randomUUID(), name: `${selected.name} · копия` };
    setItems((current) => {
      const index = current.findIndex((item) => item.id === selected.id);
      const next = [...current];
      next.splice(index + 1, 0, duplicate);
      return next;
    });
    setSelectedId(duplicate.id);
  };

  const expandPdf = () => {
    if (!selected || selected.kind !== "pdf") return;
    const pageCount = sourceFiles[selected.path]?.pageCount;
    if (!pageCount || pageCount < 2) return;
    const pages = Array.from({ length: pageCount }, (_, index) => ({
      ...selected,
      id: crypto.randomUUID(),
      name: `${selected.name} · стр. ${index + 1}`,
      pageRange: String(index + 1)
    }));
    setItems((current) => {
      const index = current.findIndex((item) => item.id === selected.id);
      const next = [...current];
      next.splice(index, 1, ...pages);
      return next;
    });
    setSelectedId(pages[0].id);
  };

  const reorderDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setItems((current) => {
      const from = current.findIndex((item) => item.id === draggedId);
      const to = current.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDraggedId(null);
  };

  const chooseOutput = async () => {
    const path = await pickOutputPdf("morf-collection.pdf");
    if (path) setOutputPath(path);
    return path;
  };

  const run = async () => {
    setMessage(null);
    if (!items.length) {
      setMessage({ kind: "error", text: "Добавьте изображения или PDF." });
      return;
    }
    if (!canRun) {
      setMessage({
        kind: "error",
        text: `Для этого режима нужны: ${missingEngineNames.join(", ")}.`
      });
      return;
    }
    const destination = outputPath || (await chooseOutput());
    if (!destination) return;
    setWorking(true);
    try {
      const result = await combineFiles({
        items,
        outputPath: destination,
        mode,
        pagePreset,
        orientation,
        background,
        quality,
        dpi
      });
      const outputs = result.items.flatMap((item) => (item.output ? [item.output] : []));
      const success = result.items.every((item) => item.success);
      setMessage({
        kind: success ? "success" : "error",
        text: success ? "PDF собран и сохранён." : result.items[0]?.message ?? "Не удалось собрать PDF."
      });
      onRecord(
        makeRecord(
          "combine",
          "Объединение в PDF",
          `${items.length} элементов · ${mode === "lossless" ? "без потерь" : "с макетом"}`,
          outputs,
          success
        )
      );
    } catch (error) {
      setMessage({ kind: "error", text: String(error) });
    } finally {
      setWorking(false);
    }
  };

  const previewStyle = useMemo(
    () =>
      selected
        ? {
            transform: `translate(${selected.offsetX / 5}px, ${-selected.offsetY / 5}px) rotate(${selected.rotation}deg) scale(${Math.min(selected.scale, 130) / 100})`,
            borderWidth: `${Math.min(selected.borderWidth, 6)}px`,
            borderColor: selected.borderColor
          }
        : undefined,
    [selected]
  );

  return (
    <div className="workspace-grid combine-grid">
      <main className="workspace-main">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">Редактор страниц</span>
            <h1>Объединить в PDF</h1>
            <p>Перетаскивайте страницы, затем настройте каждую отдельно.</p>
          </div>
          {items.length > 0 && (
            <DropZone
              onPaths={addPaths}
              compact
              busy={adding}
              label="Добавить страницы"
            />
          )}
        </header>

        {items.length === 0 ? (
          <DropZone
            onPaths={addPaths}
            busy={adding}
            label="Добавьте изображения или PDF"
          />
        ) : (
          <>
            <div className="page-toolbar">
              <div>
                <strong>{items.length} элементов</strong>
                <span>Перетаскивайте карточки за маркер</span>
              </div>
              <div className="page-toolbar-actions">
                <button className="button secondary small" type="button" onClick={duplicateSelected}>
                  <CopyPlus size={15} />
                  Дублировать
                </button>
                {selected?.kind === "pdf" && (
                  <button
                    className="button secondary small"
                    type="button"
                    onClick={expandPdf}
                    disabled={!sourceFiles[selected.path]?.pageCount}
                  >
                    <ScanLine size={15} />
                    Разложить страницы
                  </button>
                )}
              </div>
            </div>

            <div className="page-strip">
              {items.map((item, index) => (
                <article
                  className={`page-card ${item.id === selected?.id ? "selected" : ""}`}
                  key={item.id}
                  draggable
                  onDragStart={() => setDraggedId(item.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => reorderDrop(item.id)}
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="page-number">{index + 1}</div>
                  <GripVertical className="page-grip" size={16} />
                  <div className="mini-page">
                    <FileThumbnail
                      path={item.path}
                      page={item.kind === "pdf" ? Number.parseInt(item.pageRange, 10) || 1 : 1}
                      kind={item.kind}
                      alt={item.name}
                    />
                    {item.kind === "pdf" && <small>{item.pageRange}</small>}
                  </div>
                  <div className="page-card-copy">
                    <strong title={item.name}>{item.name}</strong>
                    <span>
                      {item.extension.toUpperCase()} · {item.scale}% · {item.rotation}°
                    </span>
                  </div>
                  <div className="page-card-actions">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        move(item.id, -1);
                      }}
                      disabled={index === 0}
                      aria-label="Поднять"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        move(item.id, 1);
                      }}
                      disabled={index === items.length - 1}
                      aria-label="Опустить"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeItem(item.id);
                      }}
                      aria-label="Удалить"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <section className="layout-stage-wrap">
              <div className="layout-stage-heading">
                <div>
                  <span className="eyebrow">Предпросмотр макета</span>
                  <h2>{selected?.name}</h2>
                </div>
                <span>локальный рендер</span>
              </div>
              <div className="layout-stage">
                <div
                  className={`paper-preview ${orientation} preset-${pagePreset}`}
                  style={{ background }}
                >
                  <div
                    className={`paper-content fit-${selected?.fit ?? "contain"}`}
                    style={previewStyle}
                  >
                    {selected && (
                      <FileThumbnail
                        path={selected.path}
                        page={
                          selected.kind === "pdf"
                            ? Number.parseInt(selected.pageRange, 10) || 1
                            : 1
                        }
                        kind={selected.kind}
                        alt={selected.name}
                        className="large-preview"
                      />
                    )}
                    {!selected && <span>Нет выбранной страницы</span>}
                  </div>
                </div>
              </div>
            </section>

            {message && (
              <div className={`result-banner ${message.kind}`}>
                {message.kind === "success" ? <Check size={18} /> : <Layers3 size={18} />}
                <span>{message.text}</span>
                {message.kind === "success" && outputPath && (
                  <button type="button" onClick={() => void revealPath(outputPath)}>
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
            <span className="eyebrow">Выбранный элемент</span>
            <h2>Макет страницы</h2>
          </div>
          <Layers3 size={20} />
        </div>

        <label className="field">
          <span>Режим PDF</span>
          <div className="segmented vertical-segmented">
            <button
              type="button"
              className={mode === "layout" ? "active" : ""}
              onClick={() => setMode("layout")}
            >
              <strong>Макет</strong>
              <small>размеры, поля, границы</small>
            </button>
            <button
              type="button"
              className={mode === "lossless" ? "active" : ""}
              onClick={() => setMode("lossless")}
              disabled={!allPdf}
            >
              <strong>Без потерь</strong>
              <small>текст и вектор сохраняются</small>
            </button>
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

        {selected && (
          <>
            {selected.kind === "pdf" && (
              <label className="field">
                <span>Страницы</span>
                <input
                  type="text"
                  value={selected.pageRange}
                  onChange={(event) => patchSelected({ pageRange: event.target.value })}
                  placeholder="1-z или 3,1-2"
                />
                <small className="field-help">Можно задать 3,1-2 или z-1 для обратного порядка.</small>
              </label>
            )}

            {mode === "layout" && (
              <>
                <div className="control-group">
                  <div className="control-heading">
                    <span>Масштаб</span>
                    <strong>{selected.scale}%</strong>
                  </div>
                  <input
                    className="range"
                    type="range"
                    min="20"
                    max="160"
                    value={selected.scale}
                    onChange={(event) => patchSelected({ scale: Number(event.target.value) })}
                  />
                </div>

                <div className="control-group compact-controls">
                  <div className="control-heading">
                    <span>Поля</span>
                    <strong>{selected.margin} pt</strong>
                  </div>
                  <input
                    className="range"
                    type="range"
                    min="0"
                    max="96"
                    value={selected.margin}
                    onChange={(event) => patchSelected({ margin: Number(event.target.value) })}
                  />
                </div>

                <div className="two-fields">
                  <label className="field">
                    <span>Сдвиг X</span>
                    <input
                      type="number"
                      value={selected.offsetX}
                      onChange={(event) => patchSelected({ offsetX: Number(event.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>Сдвиг Y</span>
                    <input
                      type="number"
                      value={selected.offsetY}
                      onChange={(event) => patchSelected({ offsetY: Number(event.target.value) })}
                    />
                  </label>
                </div>

                <div className="rotation-buttons">
                  {([0, 90, 180, 270] as const).map((rotation) => (
                    <button
                      type="button"
                      className={selected.rotation === rotation ? "active" : ""}
                      key={rotation}
                      onClick={() => patchSelected({ rotation })}
                    >
                      {rotation === 0 ? <RotateCw size={14} /> : `${rotation}°`}
                    </button>
                  ))}
                </div>

                <div className="two-fields">
                  <label className="field">
                    <span>Граница, pt</span>
                    <input
                      type="number"
                      min="0"
                      max="24"
                      value={selected.borderWidth}
                      onChange={(event) =>
                        patchSelected({ borderWidth: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="field color-field">
                    <span>Цвет</span>
                    <input
                      type="color"
                      value={selected.borderColor}
                      onChange={(event) => patchSelected({ borderColor: event.target.value })}
                    />
                  </label>
                </div>

                <label className="field">
                  <span>Вписывание</span>
                  <div className="select-wrap">
                    <select
                      value={selected.fit}
                      onChange={(event) =>
                        patchSelected({ fit: event.target.value as CombineItem["fit"] })
                      }
                    >
                      <option value="contain">Вписать целиком</option>
                      <option value="cover">Заполнить страницу</option>
                      <option value="original">Исходный размер</option>
                    </select>
                    <ChevronDown size={15} />
                  </div>
                </label>
              </>
            )}
          </>
        )}

        <details className="settings-details">
          <summary>
            <span>
              <FileOutput size={16} />
              Документ
            </span>
            <ChevronDown size={15} />
          </summary>
          <div className="details-body">
            <div className="two-fields">
              <label className="field">
                <span>Бумага</span>
                <select
                  value={pagePreset}
                  onChange={(event) =>
                    setPagePreset(event.target.value as "a4" | "letter" | "source")
                  }
                >
                  <option value="a4">A4</option>
                  <option value="letter">Letter</option>
                  <option value="source">По исходнику</option>
                </select>
              </label>
              <label className="field">
                <span>Ориентация</span>
                <select
                  value={orientation}
                  onChange={(event) =>
                    setOrientation(event.target.value as "portrait" | "landscape")
                  }
                >
                  <option value="portrait">Книжная</option>
                  <option value="landscape">Альбомная</option>
                </select>
              </label>
            </div>
            <div className="two-fields">
              <label className="field color-field">
                <span>Фон</span>
                <input
                  type="color"
                  value={background}
                  onChange={(event) => setBackground(event.target.value)}
                />
              </label>
              {hasPdf && mode === "layout" && (
                <label className="field">
                  <span>PDF, dpi</span>
                  <select value={dpi} onChange={(event) => setDpi(Number(event.target.value))}>
                    <option value="96">96</option>
                    <option value="150">150</option>
                    <option value="220">220</option>
                    <option value="300">300</option>
                  </select>
                </label>
              )}
            </div>
            <div className="control-heading">
              <span>Качество изображений</span>
              <strong>{quality}%</strong>
            </div>
            <input
              className="range"
              type="range"
              min="50"
              max="100"
              value={quality}
              onChange={(event) => setQuality(Number(event.target.value))}
            />
          </div>
        </details>

        <button
          className="folder-field"
          type="button"
          onClick={() => void chooseOutput()}
          title={outputPath}
        >
          <FileOutput size={16} />
          <span>{outputPath || "Куда сохранить PDF"}</span>
        </button>

        <div className="inspector-spacer" />
        <button
          className="button primary wide"
          type="button"
          disabled={!items.length || working || !canRun}
          onClick={() => void run()}
        >
          {working ? <span className="button-loader" /> : <Layers3 size={18} />}
          {working ? "Собираем…" : "Собрать PDF"}
        </button>
        {!canRun && (
          <p className="inspector-hint">
            Для выбранного режима установите {missingEngineNames.join(" и ")}.
          </p>
        )}
      </aside>
    </div>
  );
}
