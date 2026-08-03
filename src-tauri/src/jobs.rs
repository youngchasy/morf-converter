use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use crate::{
    conversion,
    model::{ConversionRequest, JobSnapshot},
};

const CANCELLED: &str = "__MORF_JOB_CANCELLED__";

struct JobControl {
    paused: AtomicBool,
    cancelled: AtomicBool,
    lock: Mutex<()>,
    changed: Condvar,
}

impl JobControl {
    fn new() -> Self {
        Self {
            paused: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
            lock: Mutex::new(()),
            changed: Condvar::new(),
        }
    }

    fn checkpoint(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err(CANCELLED.to_string());
        }
        let mut guard = self
            .lock
            .lock()
            .map_err(|_| "Очередь недоступна".to_string())?;
        while self.paused.load(Ordering::Acquire) && !self.cancelled.load(Ordering::Acquire) {
            let waited = self
                .changed
                .wait_timeout(guard, Duration::from_millis(300))
                .map_err(|_| "Очередь недоступна".to_string())?;
            guard = waited.0;
        }
        if self.cancelled.load(Ordering::Acquire) {
            Err(CANCELLED.to_string())
        } else {
            Ok(())
        }
    }

    fn pause(&self) {
        self.paused.store(true, Ordering::Release);
    }

    fn resume(&self) {
        self.paused.store(false, Ordering::Release);
        self.changed.notify_all();
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.changed.notify_all();
    }
}

struct JobEntry {
    snapshot: JobSnapshot,
    control: Arc<JobControl>,
}

struct GateState {
    active: usize,
}

struct JobGate {
    state: Mutex<GateState>,
    changed: Condvar,
    limit: AtomicUsize,
}

impl JobGate {
    fn new(limit: usize) -> Self {
        Self {
            state: Mutex::new(GateState { active: 0 }),
            changed: Condvar::new(),
            limit: AtomicUsize::new(limit.clamp(1, 8)),
        }
    }

    fn set_limit(&self, limit: usize) {
        self.limit.store(limit.clamp(1, 8), Ordering::Release);
        self.changed.notify_all();
    }

    fn acquire(self: &Arc<Self>, control: &JobControl) -> Option<JobPermit> {
        let mut state = self.state.lock().ok()?;
        loop {
            if control.cancelled.load(Ordering::Acquire) {
                return None;
            }
            if control.paused.load(Ordering::Acquire) {
                let waited = self
                    .changed
                    .wait_timeout(state, Duration::from_millis(300))
                    .ok()?;
                state = waited.0;
                continue;
            }
            if state.active < self.limit.load(Ordering::Acquire) {
                state.active += 1;
                return Some(JobPermit {
                    gate: Arc::clone(self),
                });
            }
            let waited = self
                .changed
                .wait_timeout(state, Duration::from_millis(300))
                .ok()?;
            state = waited.0;
        }
    }
}

struct JobPermit {
    gate: Arc<JobGate>,
}

impl Drop for JobPermit {
    fn drop(&mut self) {
        if let Ok(mut state) = self.gate.state.lock() {
            state.active = state.active.saturating_sub(1);
            self.gate.changed.notify_all();
        }
    }
}

struct JobManagerInner {
    jobs: Mutex<HashMap<String, JobEntry>>,
    gate: Arc<JobGate>,
}

#[derive(Clone)]
pub struct JobManager {
    inner: Arc<JobManagerInner>,
}

impl JobManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(JobManagerInner {
                jobs: Mutex::new(HashMap::new()),
                gate: Arc::new(JobGate::new(2)),
            }),
        }
    }

    pub fn set_limit(&self, limit: usize) {
        self.inner.gate.set_limit(limit);
    }

    pub fn start_conversion(&self, request: ConversionRequest) -> Result<String, String> {
        if request.inputs.is_empty() {
            return Err("Очередь пуста".to_string());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let control = Arc::new(JobControl::new());
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let snapshot = JobSnapshot {
            id: id.clone(),
            operation: "convert".to_string(),
            status: "queued".to_string(),
            progress: 0,
            completed: 0,
            total: request.inputs.len(),
            current_file: None,
            message: Some("Ожидает свободный слот".to_string()),
            result: None,
            created_at,
        };
        self.inner
            .jobs
            .lock()
            .map_err(|_| "Диспетчер задач недоступен".to_string())?
            .insert(
                id.clone(),
                JobEntry {
                    snapshot,
                    control: Arc::clone(&control),
                },
            );

        let manager = self.clone();
        let job_id = id.clone();
        std::thread::spawn(move || {
            let Some(_permit) = manager.inner.gate.acquire(&control) else {
                manager.finish_cancelled(&job_id);
                return;
            };
            if control.cancelled.load(Ordering::Acquire) {
                manager.finish_cancelled(&job_id);
                return;
            }
            manager.patch(&job_id, |snapshot| {
                if control.paused.load(Ordering::Acquire) {
                    snapshot.status = "paused".to_string();
                    snapshot.message = Some("Задача приостановлена".to_string());
                } else {
                    snapshot.status = "running".to_string();
                    snapshot.message = Some("Обработка началась".to_string());
                }
            });

            let progress_manager = manager.clone();
            let progress_id = job_id.clone();
            let checkpoint_control = Arc::clone(&control);
            let result = conversion::run_with_control(
                request,
                move |completed, total, current| {
                    progress_manager.patch(&progress_id, |snapshot| {
                        snapshot.completed = completed;
                        snapshot.total = total;
                        snapshot.progress = if total == 0 {
                            0
                        } else {
                            ((completed * 100) / total).min(100) as u8
                        };
                        snapshot.current_file = current.map(ToOwned::to_owned);
                        snapshot.message = current
                            .map(|path| format!("Обрабатывается {path}"))
                            .or_else(|| Some(format!("Готово {completed} из {total}")));
                    });
                },
                move || checkpoint_control.checkpoint(),
            );

            match result {
                Ok(batch) => {
                    let failed = batch.items.iter().filter(|item| !item.success).count();
                    manager.patch(&job_id, |snapshot| {
                        snapshot.status = if failed == 0 {
                            "completed".to_string()
                        } else {
                            "failed".to_string()
                        };
                        snapshot.progress = 100;
                        snapshot.completed = snapshot.total;
                        snapshot.current_file = None;
                        snapshot.message = Some(if failed == 0 {
                            "Все файлы обработаны".to_string()
                        } else {
                            format!("Завершено с ошибками: {failed}")
                        });
                        snapshot.result = Some(batch);
                    });
                }
                Err(message) if message == CANCELLED => manager.finish_cancelled(&job_id),
                Err(message) => manager.patch(&job_id, |snapshot| {
                    snapshot.status = "failed".to_string();
                    snapshot.current_file = None;
                    snapshot.message = Some(message);
                }),
            }
        });

        Ok(id)
    }

    pub fn get(&self, id: &str) -> Result<JobSnapshot, String> {
        self.inner
            .jobs
            .lock()
            .map_err(|_| "Диспетчер задач недоступен".to_string())?
            .get(id)
            .map(|entry| entry.snapshot.clone())
            .ok_or_else(|| "Задача не найдена".to_string())
    }

    pub fn list(&self) -> Result<Vec<JobSnapshot>, String> {
        let mut jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Диспетчер задач недоступен".to_string())?
            .values()
            .map(|entry| entry.snapshot.clone())
            .collect::<Vec<_>>();
        jobs.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(jobs)
    }

    pub fn pause(&self, id: &str) -> Result<JobSnapshot, String> {
        let mut jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Диспетчер задач недоступен".to_string())?;
        let entry = jobs
            .get_mut(id)
            .ok_or_else(|| "Задача не найдена".to_string())?;
        if matches!(entry.snapshot.status.as_str(), "queued" | "running") {
            entry.control.pause();
            self.inner.gate.changed.notify_all();
            entry.snapshot.status = "paused".to_string();
            entry.snapshot.message = Some("Пауза вступит в силу после текущего файла".to_string());
        }
        Ok(entry.snapshot.clone())
    }

    pub fn resume(&self, id: &str) -> Result<JobSnapshot, String> {
        let mut jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Диспетчер задач недоступен".to_string())?;
        let entry = jobs
            .get_mut(id)
            .ok_or_else(|| "Задача не найдена".to_string())?;
        if entry.snapshot.status == "paused" {
            entry.control.resume();
            self.inner.gate.changed.notify_all();
            entry.snapshot.status = "running".to_string();
            entry.snapshot.message = Some("Обработка продолжена".to_string());
        }
        Ok(entry.snapshot.clone())
    }

    pub fn cancel(&self, id: &str) -> Result<JobSnapshot, String> {
        let mut jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Диспетчер задач недоступен".to_string())?;
        let entry = jobs
            .get_mut(id)
            .ok_or_else(|| "Задача не найдена".to_string())?;
        if matches!(
            entry.snapshot.status.as_str(),
            "queued" | "running" | "paused"
        ) {
            entry.control.cancel();
            self.inner.gate.changed.notify_all();
            entry.snapshot.status = "cancelling".to_string();
            entry.snapshot.message = Some("Отмена вступит в силу после текущего файла".to_string());
        }
        Ok(entry.snapshot.clone())
    }

    fn patch(&self, id: &str, update: impl FnOnce(&mut JobSnapshot)) {
        if let Ok(mut jobs) = self.inner.jobs.lock() {
            if let Some(entry) = jobs.get_mut(id) {
                update(&mut entry.snapshot);
            }
        }
    }

    fn finish_cancelled(&self, id: &str) {
        self.patch(id, |snapshot| {
            snapshot.status = "cancelled".to_string();
            snapshot.current_file = None;
            snapshot.message = Some("Задача отменена".to_string());
        });
    }
}

impl Default for JobManager {
    fn default() -> Self {
        Self::new()
    }
}
