import { Check, Clock3, FileOutput, History, Trash2, TriangleAlert } from "lucide-react";
import { revealPath } from "../lib/backend";
import type { OperationRecord } from "../types";

const dateFormatter = new Intl.DateTimeFormat("ru", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit"
});

export function HistoryView({
  records,
  onClear
}: {
  records: OperationRecord[];
  onClear: () => void;
}) {
  return (
    <main className="workspace-main history-workspace">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">Локальный журнал</span>
          <h1>История операций</h1>
          <p>Только пути и параметры задач — содержимое файлов не копируется.</p>
        </div>
        {records.length > 0 && (
          <button className="button secondary small" type="button" onClick={onClear}>
            <Trash2 size={15} />
            Очистить
          </button>
        )}
      </header>

      {records.length === 0 ? (
        <section className="history-empty">
          <span>
            <History size={28} />
          </span>
          <h2>Пока пусто</h2>
          <p>Завершённые конвертации, объединения и разделения появятся здесь.</p>
        </section>
      ) : (
        <section className="history-list">
          {records.map((record) => (
            <article className="history-row" key={record.id}>
              <span className={`history-status ${record.success ? "success" : "error"}`}>
                {record.success ? <Check size={18} /> : <TriangleAlert size={18} />}
              </span>
              <div className="history-main">
                <div>
                  <strong>{record.title}</strong>
                  <span className="history-type">{record.type}</span>
                </div>
                <p>{record.summary}</p>
                <span className="history-date">
                  <Clock3 size={13} />
                  {dateFormatter.format(new Date(record.createdAt))}
                </span>
              </div>
              <div className="history-output">
                <span>{record.outputs.length} результатов</span>
                {record.outputs[0] && (
                  <button type="button" onClick={() => void revealPath(record.outputs[0])}>
                    <FileOutput size={15} />
                    Показать
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
