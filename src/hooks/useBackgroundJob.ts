import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelJob,
  getJob,
  pauseJob,
  resumeJob,
  startConversionJob
} from "../lib/backend";
import type { ConversionRequest, JobSnapshot } from "../types";

const activeStatuses = new Set(["queued", "running", "paused", "cancelling"]);

export function useBackgroundJob() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobSnapshot | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timeout = 0;
    const poll = async () => {
      try {
        const snapshot = await getJob(jobId);
        if (!active) return;
        setJob(snapshot);
        if (activeStatuses.has(snapshot.status)) {
          timeout = window.setTimeout(poll, 280);
        }
      } catch (error) {
        if (!active) return;
        setJob((current) =>
          current
            ? { ...current, status: "failed", message: String(error) }
            : current
        );
      }
    };
    void poll();
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [jobId]);

  const start = useCallback(async (request: ConversionRequest) => {
    const id = await startConversionJob(request);
    setJobId(id);
    setJob({
      id,
      operation: "convert",
      status: "queued",
      progress: 0,
      completed: 0,
      total: request.inputs.length,
      message: "Задача добавлена в очередь",
      createdAt: Date.now()
    });
    return id;
  }, []);

  const pause = useCallback(async () => {
    if (jobId) setJob(await pauseJob(jobId));
  }, [jobId]);

  const resume = useCallback(async () => {
    if (jobId) setJob(await resumeJob(jobId));
  }, [jobId]);

  const cancel = useCallback(async () => {
    if (jobId) setJob(await cancelJob(jobId));
  }, [jobId]);

  const reset = useCallback(() => {
    setJobId(null);
    setJob(null);
  }, []);

  const active = useMemo(
    () => Boolean(job && activeStatuses.has(job.status)),
    [job]
  );

  return { job, active, start, pause, resume, cancel, reset };
}
