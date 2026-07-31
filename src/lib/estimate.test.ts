import { describe, expect, it } from "vitest";
import type { ConversionOptions, WorkFile } from "../types";
import { estimateOutputBytes } from "./estimate";

const options: ConversionOptions = {
  quality: 80,
  fit: "contain",
  rotation: 0,
  grayscale: false,
  preserveMetadata: false,
  audioBitrate: 192,
  hardwareEncoder: "software",
  watermarkOpacity: 70,
  watermarkScale: 22,
  watermarkPosition: "bottom-right",
  subtitleMode: "off"
};

const file: WorkFile = {
  id: "1",
  path: "/photo.png",
  name: "photo.png",
  extension: "png",
  size: 10_000_000,
  kind: "image",
  status: "ready"
};

describe("output size estimate", () => {
  it("predicts a smaller JPEG than PNG", () => {
    expect(estimateOutputBytes([file], "jpg", options)).toBeLessThan(
      estimateOutputBytes([file], "png", options)
    );
  });

  it("accounts for resize and grayscale", () => {
    const optimized = estimateOutputBytes([file], "webp", {
      ...options,
      width: 800,
      grayscale: true
    });
    expect(optimized).toBeLessThan(estimateOutputBytes([file], "webp", options));
  });
});
