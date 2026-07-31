import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Layers3, XCircle } from "lucide-react";
import {
  cancelJob,
  listJobs,
  pauseJob,
  resumeJob,
  revealPath
} from "../lib/backend";
import type { JobSnapshot } from "../types";
import { JobProgress } from "./JobProgress";

const activeStatuses = new Set(["queued", "running", "paused", "cancelling"]);

export function JobQueuePanel({ excludeId }: { excludeId?: string }) {
  const [jobs, setJobs] = useState<JobSnapshot[]>([]);

  const refresh = useCallback(async () => {
    try {
      setJobs(await listJobs());
    } catch {
      // The current foreground task still reports its own error.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 650);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const visible = useMemo(
    () => jobs.filter((job) => job.id !== excludeId).slice(0, 8),
    [excludeId, jobs]
  );
  const activeCount = jobs.filter((job) => activeStatuses.has(job.status)).length;

  if (!visible.length) return null;

  return (
    <section className="job-queue-panel">
      <header>
        <div>
          <span className="eyebrow">Фоновые процессы</span>
          <h2>Очередь задач</h2>
        </div>
        <span className="queue-count">
          <Layers3 size={14} />
          Активно: {activeCount}
        </span>
      </header>

      <div className="job-queue-list">
        {visible.map((job) => {
          const outputs = job.result?.items.filter((item) => item.success).length ?? 0;
          const failures = job.result?.items.filter((item) => !item.success).length ?? 0;
          return (
            <article className="queued-job" key={job.id}>
              <JobProgress
                job={job}
                onPause={() => void pauseJob(job.id).then(refresh)}
                onResume={() => void resumeJob(job.id).then(refresh)}
                onCancel={() => void cancelJob(job.id).then(refresh)}
              />
              {job.result && (
                <div className="queued-job-result">
                  <span className={failures ? "has-errors" : ""}>
                    {failures ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                    Готово: {outputs}
                    {failures ? ` · ошибок: ${failures}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => void revealPath(job.result!.outputDir)}
                  >
                    Показать файлы
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
