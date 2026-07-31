import { useEffect, useState } from "react";
import { fileThumbnail } from "../lib/backend";
import type { FileKind } from "../types";
import { FileGlyph } from "./FileGlyph";

const cache = new Map<string, string>();

export function FileThumbnail({
  path,
  page = 1,
  kind,
  alt,
  className = ""
}: {
  path: string;
  page?: number;
  kind: FileKind;
  alt: string;
  className?: string;
}) {
  const key = `${path}:${page}`;
  const [source, setSource] = useState<string | null>(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(!source && ["image", "pdf"].includes(kind));

  useEffect(() => {
    if (!["image", "pdf"].includes(kind) || source) return;
    let active = true;
    setLoading(true);
    fileThumbnail(path, page)
      .then((value) => {
        if (!active || !value) return;
        cache.set(key, value);
        setSource(value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [key, kind, page, path, source]);

  return (
    <span className={`file-thumbnail ${loading ? "loading" : ""} ${className}`.trim()}>
      {source ? <img src={source} alt={alt} /> : <FileGlyph kind={kind} size={22} />}
    </span>
  );
}
