import { CircleCheck, CircleDashed } from "lucide-react";
import type { EngineInfo } from "../types";

export function EngineBadge({
  engine,
  compact = false
}: {
  engine?: EngineInfo;
  compact?: boolean;
}) {
  const available = engine?.installed ?? false;
  return (
    <span className={`engine-badge ${available ? "available" : "missing"} ${compact ? "compact" : ""}`}>
      {available ? <CircleCheck size={14} /> : <CircleDashed size={14} />}
      {engine?.name ?? "Неизвестный движок"}
      {!compact && <span>{available ? "готов" : "не найден"}</span>}
    </span>
  );
}
