import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
await fs.mkdir("desktop/assets", { recursive: true });
const svg = await fs.readFile("public/brand/tag-maestro-1024.png");
await sharp(svg).resize(1024, 1024).png().toFile("desktop/assets/icon.png");
if (process.platform === "darwin") {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "tag-maestro-icon-"));
  const directory = path.join(temporary, "TagMaestro.iconset");
  await fs.mkdir(directory);
  for (const size of [16, 32, 128, 256, 512]) {
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(path.join(directory, `icon_${size}x${size}.png`));
    await sharp(svg)
      .resize(size * 2, size * 2)
      .png()
      .toFile(path.join(directory, `icon_${size}x${size}@2x.png`));
  }
  execFileSync("iconutil", [
    "--convert",
    "icns",
    "--output",
    "desktop/assets/icon.icns",
    directory,
  ]);
}
console.log("Desktop icon generated from the shared Tag Maestro music-tag logo.");
