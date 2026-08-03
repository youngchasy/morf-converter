# Morf bundled engines

Full Morf installers contain separate command-line programs distributed by
their respective projects. They are invoked as independent processes and are
not linked into the Morf executable.

| Component | Project and source | License |
|---|---|---|
| FFmpeg | https://ffmpeg.org/ and https://git.ffmpeg.org/ffmpeg.git | GPL-2.0-or-later for the bundled conda-forge build |
| Pandoc | https://pandoc.org/ and https://github.com/jgm/pandoc | GPL-2.0-or-later |
| qpdf | https://qpdf.sourceforge.io/ and https://github.com/qpdf/qpdf | Apache-2.0 |
| Poppler | https://poppler.freedesktop.org/ | GPL-2.0-or-later |
| Tesseract OCR | https://github.com/tesseract-ocr/tesseract | Apache-2.0 |
| ExifTool | https://exiftool.org/ | GPL-1.0-or-later / Artistic License |
| 7-Zip | https://www.7-zip.org/ and https://github.com/ip7z/7zip | LGPL-2.1-or-later, BSD-3-Clause and unRAR restriction |
| LibreOffice | https://www.libreoffice.org/ and https://git.libreoffice.org/core | MPL-2.0 and LGPL-3.0-or-later |
| pixi-unpack | https://github.com/Quantco/pixi-pack | BSD-3-Clause |

The offline `environment.tar` retains the original conda packages and their
metadata. Exact dependency versions are preserved in the bundled `pixi.lock`;
archive checksums are recorded in `manifest.json` in each platform installer.
Redistributors are responsible for reviewing the licenses and source-code
obligations that apply to their chosen engine builds.
