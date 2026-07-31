import {
  Braces,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo
} from "lucide-react";
import type { FileKind } from "../types";

export function FileGlyph({ kind, size = 20 }: { kind: FileKind; size?: number }) {
  const props = { size, strokeWidth: 1.8 };
  if (kind === "image") return <FileImage {...props} />;
  if (kind === "video") return <FileVideo {...props} />;
  if (kind === "audio") return <FileAudio {...props} />;
  if (kind === "document" || kind === "pdf") return <FileText {...props} />;
  if (kind === "data") return <Braces {...props} />;
  if (kind === "archive") return <FileArchive {...props} />;
  return <File {...props} />;
}
