import { Check, CircleAlert, LoaderCircle, Trash2, X } from "lucide-react";
import { formatBytes } from "../lib/files";
import type { WorkFile } from "../types";
import { FileGlyph } from "./FileGlyph";

interface FileQueueProps {
  files: WorkFile[];
  onRemove: (id: string) => void;
  onClear?: () => void;
  dense?: boolean;
}

export function FileQueue({ files, onRemove, onClear, dense = false }: FileQueueProps) {
  if (!files.length) return null;

  return (
    <section className={`file-queue ${dense ? "dense" : ""}`}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Очередь</span>
          <h2>
            {files.length} {files.length === 1 ? "файл" : files.length < 5 ? "файла" : "файлов"}
          </h2>
        </div>
        {onClear && (
          <button className="text-button danger" type="button" onClick={onClear}>
            <Trash2 size={14} />
            Очистить
          </button>
        )}
      </div>
      <div className="file-list">
        {files.map((file) => (
          <article className={`file-row status-${file.status}`} key={file.id}>
            <span className={`file-glyph kind-${file.kind}`}>
              <FileGlyph kind={file.kind} />
            </span>
            <span className="file-main">
              <span className="file-name" title={file.path}>
                {file.name}
              </span>
              <span className="file-meta">
                {file.extension.toUpperCase() || "FILE"} · {formatBytes(file.size)}
                {file.detail ? ` · ${file.detail}` : ""}
              </span>
              {file.error && <span className="file-error">{file.error}</span>}
            </span>
            <span className="file-state" aria-label={file.status}>
              {file.status === "working" && <LoaderCircle className="spin" size={18} />}
              {file.status === "done" && <Check size={18} />}
              {file.status === "error" && <CircleAlert size={18} />}
              {file.status === "ready" && (
                <button
                  className="icon-button subtle"
                  type="button"
                  onClick={() => onRemove(file.id)}
                  aria-label={`Удалить ${file.name}`}
                >
                  <X size={17} />
                </button>
              )}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
