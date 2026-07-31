import { useCallback, useState } from "react";
import { inspectPaths } from "../lib/backend";
import { uniqueByPath } from "../lib/files";
import type { WorkFile } from "../types";

export function useFileQueue(initial: WorkFile[] = []) {
  const [files, setFiles] = useState<WorkFile[]>(initial);
  const [isAdding, setIsAdding] = useState(false);

  const addPaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return [];
    setIsAdding(true);
    try {
      const inspected = await inspectPaths(paths);
      setFiles((current) => uniqueByPath([...current, ...inspected]));
      return inspected;
    } finally {
      setIsAdding(false);
    }
  }, []);

  const remove = useCallback((id: string) => {
    setFiles((current) => current.filter((file) => file.id !== id));
  }, []);

  const clear = useCallback(() => setFiles([]), []);

  const patch = useCallback((id: string, update: Partial<WorkFile>) => {
    setFiles((current) =>
      current.map((file) => (file.id === id ? { ...file, ...update } : file))
    );
  }, []);

  const markAll = useCallback((update: Partial<WorkFile>) => {
    setFiles((current) => current.map((file) => ({ ...file, ...update })));
  }, []);

  return { files, setFiles, isAdding, addPaths, remove, clear, patch, markAll };
}
