import {
  Combine,
  Files,
  History,
  Layers3,
  PanelLeftClose,
  Repeat2,
  Scissors,
  Sparkles
} from "lucide-react";
import type { WorkspaceId } from "../types";

const navigation: Array<{
  id: WorkspaceId;
  label: string;
  hint: string;
  icon: typeof Repeat2;
}> = [
  { id: "convert", label: "Конвертация", hint: "Формат и качество", icon: Repeat2 },
  { id: "combine", label: "Объединить", hint: "Страницы и макет", icon: Combine },
  { id: "split", label: "Разделить", hint: "Страницы и части", icon: Scissors },
  { id: "tools", label: "Инструменты", hint: "Быстрые операции", icon: Sparkles },
  { id: "history", label: "История", hint: "Последние задачи", icon: History }
];

export function Sidebar({
  active,
  onChange,
  collapsed,
  onToggle
}: {
  active: WorkspaceId;
  onChange: (id: WorkspaceId) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Layers3 size={21} />
        </span>
        {!collapsed && (
          <span className="brand-copy">
            <strong>Morf</strong>
            <small>file workshop</small>
          </span>
        )}
      </div>

      <nav className="main-nav" aria-label="Разделы">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={active === item.id ? "active" : ""}
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-icon">
                <Icon size={19} />
              </span>
              {!collapsed && (
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        {!collapsed && (
          <div className="local-note">
            <Files size={16} />
            <span>
              <strong>Только локально</strong>
              <small>без загрузки в облако</small>
            </span>
          </div>
        )}
        <button
          className="collapse-button"
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
        >
          <PanelLeftClose size={18} />
        </button>
      </div>
    </aside>
  );
}
