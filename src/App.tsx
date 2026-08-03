import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Circle, HardDrive, PackageOpen, RefreshCw } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import {
  detectEngines,
  getInitialFiles,
  isDesktop,
  listenOpenFiles
} from "./lib/backend";
import { loadHistory, saveHistory } from "./lib/history";
import type {
  EngineInfo,
  OperationRecord,
  WorkspaceId
} from "./types";
import { CombineView } from "./workspaces/CombineView";
import { ConvertView } from "./workspaces/ConvertView";
import { HistoryView } from "./workspaces/HistoryView";
import { SplitView } from "./workspaces/SplitView";
import { ToolsView } from "./workspaces/ToolsView";

const titles: Record<WorkspaceId, string> = {
  convert: "Конвертация",
  combine: "Объединить",
  split: "Разделить",
  tools: "Инструменты",
  history: "История"
};

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceId>("convert");
  const [collapsed, setCollapsed] = useState(false);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [checking, setChecking] = useState(true);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [history, setHistory] = useState<OperationRecord[]>(loadHistory);
  const [incomingPaths, setIncomingPaths] = useState<string[]>([]);

  const refreshEngines = useCallback(async () => {
    setChecking(true);
    setEngineError(null);
    try {
      setEngines(await detectEngines());
    } catch (error) {
      setEngines([]);
      setEngineError(String(error));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refreshEngines();
  }, [refreshEngines]);

  useEffect(() => {
    let active = true;
    let unlisten: () => void = () => undefined;
    const accept = (paths: string[]) => {
      if (!active || !paths.length) return;
      setWorkspace("convert");
      setIncomingPaths(paths);
    };
    void (async () => {
      const stop = await listenOpenFiles(accept);
      if (!active) {
        stop();
        return;
      }
      unlisten = stop;
      accept(await getInitialFiles());
    })();
    return () => {
      active = false;
      unlisten();
    };
  }, []);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  const addRecord = useCallback((record: OperationRecord) => {
    setHistory((current) => [record, ...current].slice(0, 40));
  }, []);

  const readyEngines = useMemo(
    () => engines.filter((engine) => engine.installed).length,
    [engines]
  );

  return (
    <div className="app-shell">
      <Sidebar
        active={workspace}
        onChange={setWorkspace}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />

      <div className="app-content">
        <div className="topbar">
          <div className="topbar-context">
            <span>Morf</span>
            <Circle size={4} fill="currentColor" />
            <strong>{titles[workspace]}</strong>
          </div>
          <div className="topbar-status">
            <span className="privacy-status">
              <HardDrive size={14} />
              {isDesktop() ? "Локальная обработка" : "Режим предпросмотра"}
            </span>
            <button
              type="button"
              onClick={() => void refreshEngines()}
              title="Проверить движки"
              aria-label="Проверить движки"
            >
              <RefreshCw className={checking ? "spin" : ""} size={15} />
              {!collapsed && (
                <span>
                  {readyEngines}/{engines.length || "…"}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="workspace">
          {checking && engines.length === 0 ? (
            <section className="engine-bootstrap" aria-live="polite">
              <span className="engine-bootstrap-icon">
                <PackageOpen size={28} />
                <RefreshCw className="spin" size={16} />
              </span>
              <h1>Подготавливаем встроенные движки</h1>
              <p>
                Это происходит только после первой установки или обновления. Morf
                распаковывает локальный комплект — интернет и терминал не нужны.
              </p>
              <small>Большой комплект с LibreOffice может занять несколько минут.</small>
            </section>
          ) : engineError && engines.length === 0 ? (
            <section className="engine-bootstrap error" role="alert">
              <span className="engine-bootstrap-icon">
                <AlertTriangle size={29} />
              </span>
              <h1>Не удалось подготовить движки</h1>
              <p>{engineError}</p>
              <button
                className="button primary"
                type="button"
                onClick={() => void refreshEngines()}
              >
                <RefreshCw size={15} /> Повторить
              </button>
            </section>
          ) : workspace === "convert" ? (
            <ConvertView
              engines={engines}
              onRecord={addRecord}
              incomingPaths={incomingPaths}
              onConsumeIncoming={() => setIncomingPaths([])}
            />
          ) : workspace === "combine" ? (
            <CombineView engines={engines} onRecord={addRecord} />
          ) : workspace === "split" ? (
            <SplitView engines={engines} onRecord={addRecord} />
          ) : workspace === "tools" ? (
            <ToolsView
              engines={engines}
              onNavigate={setWorkspace}
              onRefresh={() => void refreshEngines()}
            />
          ) : (
            <HistoryView records={history} onClear={() => setHistory([])} />
          )}
        </div>
      </div>
    </div>
  );
}
