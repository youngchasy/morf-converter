import {
  Braces,
  CheckCircle2,
  CircleDashed,
  FileArchive,
  FileImage,
  FileText,
  FileVideo,
  Gauge,
  Layers3,
  RefreshCw,
  Scissors,
  Sparkles
} from "lucide-react";
import { AdvancedTools } from "../components/AdvancedTools";
import { EngineBadge } from "../components/EngineBadge";
import { FORMAT_GROUPS } from "../lib/catalog";
import type { EngineInfo, WorkspaceId } from "../types";

const quickTools: Array<{
  title: string;
  description: string;
  action: string;
  workspace: WorkspaceId;
  icon: typeof Gauge;
  tone: string;
}> = [
  {
    title: "Сжать изображение",
    description: "Уменьшить вес без заметной потери качества",
    action: "Открыть конвертацию",
    workspace: "convert",
    icon: FileImage,
    tone: "mint"
  },
  {
    title: "Видео для отправки",
    description: "MP4, разумный размер и совместимость",
    action: "Настроить видео",
    workspace: "convert",
    icon: FileVideo,
    tone: "coral"
  },
  {
    title: "Собрать сканы",
    description: "Порядок, поля и единый PDF",
    action: "Открыть редактор",
    workspace: "combine",
    icon: Layers3,
    tone: "violet"
  },
  {
    title: "Нарезать страницы",
    description: "PDF по одной или несколько страниц",
    action: "Разделить PDF",
    workspace: "split",
    icon: Scissors,
    tone: "sand"
  },
  {
    title: "Нормализовать данные",
    description: "JSON, YAML, TOML и CSV с форматированием",
    action: "Выбрать формат",
    workspace: "convert",
    icon: Braces,
    tone: "blue"
  },
  {
    title: "Документ в PDF",
    description: "DOCX, ODT, таблицы и презентации",
    action: "Выбрать документ",
    workspace: "convert",
    icon: FileText,
    tone: "rose"
  }
];

export function ToolsView({
  engines,
  onNavigate,
  onRefresh
}: {
  engines: EngineInfo[];
  onNavigate: (workspace: WorkspaceId) => void;
  onRefresh: () => void;
}) {
  const ready = engines.filter((engine) => engine.installed).length;

  return (
    <main className="workspace-main tools-workspace">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">Рабочий набор</span>
          <h1>Инструменты</h1>
          <p>Частые сценарии и состояние локальных движков.</p>
        </div>
      </header>

      <section className="quick-tools">
        {quickTools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              className="quick-tool"
              type="button"
              key={tool.title}
              onClick={() => onNavigate(tool.workspace)}
            >
              <span className={`quick-icon ${tool.tone}`}>
                <Icon size={21} />
              </span>
              <span className="quick-copy">
                <strong>{tool.title}</strong>
                <small>{tool.description}</small>
              </span>
              <span className="quick-action">{tool.action}</span>
            </button>
          );
        })}
      </section>

      <section className="engine-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Возможности</span>
            <h2>Движки обработки</h2>
          </div>
          <div className="heading-actions">
            <span className="readiness">
              {ready}/{engines.length} готовы
            </span>
            <button className="button secondary small" type="button" onClick={onRefresh}>
              <RefreshCw size={14} />
              Проверить
            </button>
          </div>
        </div>

        <div className="engine-grid">
          {engines.map((engine) => (
            <article className={`engine-card ${engine.installed ? "ready" : ""}`} key={engine.id}>
              <div className="engine-card-head">
                <span className="engine-logo">
                  {engine.installed ? <CheckCircle2 size={19} /> : <CircleDashed size={19} />}
                </span>
                <EngineBadge engine={engine} compact />
              </div>
              <p>{engine.description}</p>
              <div className="tag-row">
                {engine.formats.slice(0, 6).map((format) => (
                  <span key={format}>{format}</span>
                ))}
              </div>
              {engine.version && <small className="engine-version">{engine.version}</small>}
            </article>
          ))}
        </div>
      </section>

      <section className="format-coverage">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Каталог</span>
            <h2>Популярные форматы</h2>
          </div>
          <span className="readiness">
            {FORMAT_GROUPS.reduce((sum, group) => sum + group.formats.length, 0)} вариантов
          </span>
        </div>
        <div className="coverage-grid">
          {FORMAT_GROUPS.map((group, index) => {
            const Icon = [FileImage, FileVideo, FileText, FileArchive, Sparkles][index] ?? Sparkles;
            return (
              <article key={group.label}>
                <Icon size={18} />
                <div>
                  <strong>{group.label}</strong>
                  <p>{group.formats.map((format) => format.extension.toUpperCase()).join(" · ")}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <AdvancedTools engines={engines} onRefresh={onRefresh} />
    </main>
  );
}
