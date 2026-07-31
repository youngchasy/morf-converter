import { CircleStop, Pause, Play } from "lucide-react";
import type { JobSnapshot } from "../types";

export function JobProgress({
  job,
  onPause,
  onResume,
  onCancel
}: {
  job: JobSnapshot;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const active = ["queued", "running", "paused", "cancelling"].includes(job.status);
  return (
    <section className={`job-progress status-${job.status}`}>
      <div className="job-progress-head">
        <div>
          <strong>
            {job.status === "queued"
              ? "В очереди"
              : job.status === "paused"
                ? "На паузе"
                : job.status === "cancelling"
                  ? "Отменяем"
                  : job.status === "completed"
                    ? "Готово"
                    : job.status === "failed"
                      ? "Завершено с ошибками"
                      : job.status === "cancelled"
                        ? "Отменено"
                        : "Конвертация"}
          </strong>
          <span>{job.message}</span>
        </div>
        <b>{job.progress}%</b>
      </div>
      <div className="progress-track" aria-label={`Прогресс ${job.progress}%`}>
        <span style={{ width: `${job.progress}%` }} />
      </div>
      <div className="job-progress-foot">
        <span>
          {job.completed}/{job.total} файлов
        </span>
        {active && (
          <div>
            {job.status === "paused" ? (
              <button type="button" onClick={onResume}>
                <Play size={13} />
                Продолжить
              </button>
            ) : (
              <button
                type="button"
                onClick={onPause}
                disabled={job.status === "queued" || job.status === "cancelling"}
              >
                <Pause size={13} />
                Пауза
              </button>
            )}
            <button
              className="danger"
              type="button"
              onClick={onCancel}
              disabled={job.status === "cancelling"}
            >
              <CircleStop size={13} />
              Отмена
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
