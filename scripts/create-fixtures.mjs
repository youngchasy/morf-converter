import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { deflateSync, gzipSync } from "node:zlib";

const root = resolve("tests/fixtures");
mkdirSync(root, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function createPng(path) {
  const width = 320;
  const height = 180;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      row[offset] = 20 + Math.round((x / width) * 70);
      row[offset + 1] = 90 + Math.round((y / height) * 90);
      row[offset + 2] = 111 + Math.round((x / width) * 70);
      row[offset + 3] = 255;
    }
    rows.push(row);
  }
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
      pngChunk("IEND", Buffer.alloc(0))
    ])
  );
}

function createWav(path) {
  const rate = 44_100;
  const seconds = 2;
  const samples = rate * seconds;
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(1, index / 2_000, (samples - index) / 2_000);
    pcm.writeInt16LE(
      Math.round(Math.sin((index * Math.PI * 2 * 440) / rate) * 12_000 * fade),
      index * 2
    );
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([header, pcm]));
}

function createPdf(path) {
  const streams = [
    "BT /F1 24 Tf 72 740 Td (Morf Alpha - page 1) Tj 0 -38 Td /F1 12 Tf (PDF preview and split fixture) Tj ET",
    "BT /F1 24 Tf 72 740 Td (Morf Alpha - page 2) Tj 0 -38 Td /F1 12 Tf (Reordering, OCR and merge test) Tj ET"
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(streams[0])} >>\nstream\n${streams[0]}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${Buffer.byteLength(streams[1])} >>\nstream\n${streams[1]}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(path, body);
}

const files = {
  png: join(root, "gradient-320x180.png"),
  wav: join(root, "tone-440hz.wav"),
  pdf: join(root, "two-pages.pdf"),
  rtf: join(root, "document.rtf")
};

createPng(files.png);
createWav(files.wav);
createPdf(files.pdf);
writeFileSync(
  files.rtf,
  String.raw`{\rtf1\ansi\deff0 {\fonttbl {\f0 Arial;}}\f0\fs28 Morf Alpha 0.1\par\fs22 Document conversion fixture.\par}`
);
writeFileSync(join(root, "data.json"), JSON.stringify({ name: "Morf", alpha: true, items: [1, 2, 3] }, null, 2));
writeFileSync(join(root, "data.yaml"), "name: Morf\nalpha: true\nitems:\n  - 1\n  - 2\n  - 3\n");
writeFileSync(join(root, "data.toml"), 'name = "Morf"\nalpha = true\nitems = [1, 2, 3]\n');
writeFileSync(join(root, "table.csv"), "name,format,ready\nimage,png,true\naudio,wav,true\n");
writeFileSync(join(root, "readme.md"), "# Morf fixture\n\nMarkdown, **UTF-8** and кириллица.\n");
writeFileSync(join(root, "page.html"), "<!doctype html><meta charset=\"utf-8\"><h1>Morf fixture</h1><p>HTML document.</p>\n");
writeFileSync(join(root, "data.xml"), "<?xml version=\"1.0\"?><morf alpha=\"true\"><format>xml</format></morf>\n");
writeFileSync(join(root, "sample.ts"), "type Format = \"png\" | \"pdf\";\nconst format: Format = \"png\";\nconsole.log(format);\n");
writeFileSync(
  join(root, "subtitles.srt"),
  "1\n00:00:00,000 --> 00:00:01,000\nMorf Alpha\n\n2\n00:00:01,000 --> 00:00:02,000\nSubtitle fixture\n"
);
writeFileSync(join(root, "readme.md.gz"), gzipSync(readFileSync(join(root, "readme.md"))));

const optional = [];
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

if (run("ffmpeg", ["-version"])) {
  if (run("ffmpeg", ["-y", "-i", files.png, join(root, "gradient.jpg")])) {
    optional.push("gradient.jpg");
  }
  if (run("ffmpeg", ["-y", "-i", files.wav, join(root, "tone.mp3")])) {
    optional.push("tone.mp3");
  }
  if (run("ffmpeg", ["-y", "-i", files.wav, join(root, "tone.flac")])) {
    optional.push("tone.flac");
  }
  if (
    run("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=#147d6f:s=320x180:d=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-shortest",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      join(root, "video-2s.mp4")
    ])
  ) {
    optional.push("video-2s.mp4");
  }
}

if (run("soffice", ["--version"])) {
  if (run("soffice", ["--headless", "--convert-to", "docx", "--outdir", root, files.rtf])) {
    optional.push("document.docx");
  }
}

if (run("zip", ["-v"])) {
  const archive = join(root, "samples.zip");
  if (run("zip", ["-j", archive, join(root, "data.json"), join(root, "table.csv")])) {
    optional.push("samples.zip");
  }
}

const manifest = {
  generatorVersion: 1,
  required: [
    "gradient-320x180.png",
    "tone-440hz.wav",
    "two-pages.pdf",
    "document.rtf",
    "data.json",
    "data.yaml",
    "data.toml",
    "table.csv",
    "readme.md",
    "page.html",
    "data.xml",
    "sample.ts",
    "subtitles.srt",
    "readme.md.gz"
  ],
  optional
};
writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

if (!existsSync(join(root, "watermark.png"))) {
  copyFileSync(files.png, join(root, "watermark.png"));
}

console.log(`Created ${manifest.required.length + optional.length + 2} fixture files in ${root}`);
