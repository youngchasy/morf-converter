import { describe, expect, it } from "vitest";
import {
  kindFromExtension,
  requiredEngine,
  requiredEngines,
  targetsForKind
} from "./catalog";
import { extensionOf, formatBytes, uniqueByPath } from "./files";
import type { WorkFile } from "../types";

describe("format catalog", () => {
  it("recognizes common file kinds case-insensitively", () => {
    expect(kindFromExtension("JPG")).toBe("image");
    expect(kindFromExtension("MP4")).toBe("video");
    expect(kindFromExtension("docx")).toBe("document");
    expect(kindFromExtension("pdf")).toBe("pdf");
  });

  it("routes native image-to-PDF conversion to Morf Core", () => {
    const pdf = targetsForKind("image").find((format) => format.extension === "pdf");
    expect(requiredEngine("image", pdf)).toBe("native");
  });

  it("routes PDF rendering to Poppler", () => {
    const png = targetsForKind("pdf").find((format) => format.extension === "png");
    expect(requiredEngine("pdf", png)).toBe("poppler");
  });

  it("routes video frames through FFmpeg rather than the image core", () => {
    const png = targetsForKind("video").find((format) => format.extension === "png");
    expect(requiredEngine("video", png)).toBe("ffmpeg");
  });

  it("routes HEIC and SVG decoding through FFmpeg", () => {
    const png = targetsForKind("image", "heic").find(
      (format) => format.extension === "png"
    );
    expect(requiredEngine("image", png, "heic")).toBe("ffmpeg");
    expect(requiredEngine("image", png, "svg")).toBe("ffmpeg");
  });

  it("does not offer document-only targets for source code", () => {
    const targets = targetsForKind("data", "ts").map((format) => format.extension);
    expect(new Set(targets)).toEqual(new Set(["json", "yaml", "toml", "txt", "md"]));
    expect(targets).toHaveLength(5);
  });

  it("limits spreadsheet and presentation targets to meaningful families", () => {
    expect(targetsForKind("document", "xlsx").map((format) => format.extension)).not.toContain(
      "pptx"
    );
    expect(targetsForKind("document", "pptx").map((format) => format.extension)).not.toContain(
      "xlsx"
    );
  });

  it("reports both engines for legacy documents converted to markup", () => {
    const markdown = targetsForKind("document", "doc").find(
      (format) => format.extension === "md"
    );
    expect(requiredEngines("document", markdown, "doc")).toEqual([
      "libreoffice",
      "pandoc"
    ]);
  });
});

describe("file helpers", () => {
  it("handles Windows and POSIX paths", () => {
    expect(extensionOf("C:\\files\\photo.JPEG")).toBe("jpeg");
    expect(extensionOf("/tmp/archive.tar.gz")).toBe("gz");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(1536)).toBe("1.5 КБ");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 МБ");
  });

  it("removes duplicate paths without changing order", () => {
    const base: WorkFile = {
      id: "1",
      path: "/one.png",
      name: "one.png",
      extension: "png",
      size: 1,
      kind: "image",
      status: "ready"
    };
    const result = uniqueByPath([
      base,
      { ...base, id: "2", path: "/ONE.png" },
      { ...base, id: "3", path: "/two.png" }
    ]);
    expect(result.map((file) => file.id)).toEqual(["1", "3"]);
  });
});
