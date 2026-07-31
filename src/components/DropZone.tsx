import { useEffect, useRef, useState } from "react";
import { FilePlus2, LoaderCircle, Plus } from "lucide-react";
import { listenNativeDrops, pickFiles } from "../lib/backend";

interface DropZoneProps {
  onPaths: (paths: string[]) => unknown | Promise<unknown>;
  compact?: boolean;
  multiple?: boolean;
  busy?: boolean;
  label?: string;
}

export function DropZone({
  onPaths,
  compact = false,
  multiple = true,
  busy = false,
  label
}: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let unlisten: () => void = () => {};
    void listenNativeDrops((paths) => {
      if (mounted.current) {
        setDragging(false);
        void onPaths(multiple ? paths : paths.slice(0, 1));
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      mounted.current = false;
      unlisten();
    };
  }, [multiple, onPaths]);

  const browse = async () => {
    const paths = await pickFiles(multiple);
    await onPaths(paths);
  };

  if (compact) {
    return (
      <button className="button secondary small" type="button" onClick={browse} disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
        {label ?? "Добавить"}
      </button>
    );
  }

  return (
    <button
      className={`drop-zone ${dragging ? "dragging" : ""}`}
      type="button"
      onClick={browse}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const paths = Array.from(event.dataTransfer.files).map((file) => file.name);
        if (paths.length) void onPaths(multiple ? paths : paths.slice(0, 1));
      }}
    >
      <span className="drop-icon">
        {busy ? <LoaderCircle className="spin" size={26} /> : <FilePlus2 size={26} />}
      </span>
      <span className="drop-title">{label ?? "Перетащите файлы сюда"}</span>
      <span className="drop-copy">или нажмите, чтобы выбрать на компьютере</span>
      <span className="drop-formats">Обработка локально · исходники не покидают устройство</span>
    </button>
  );
}
