import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const binary = process.argv[2] || createRequire(import.meta.url)("electron");
const profile = await mkdtemp(path.join(os.tmpdir(), "tag-maestro-desktop-test-"));
for (const stage of ["write", "read"]) {
  const args = [
    ...(process.argv[2] ? [] : ["."]),
    "--desktop-self-test",
    `--test-stage=${stage}`,
    `--test-profile=${profile}`,
  ];
  const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
    process.stdout.write(data);
  });
  child.stderr.on("data", (data) => process.stderr.write(data));
  const timer = setTimeout(() => child.kill(), 45000);
  const status = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  clearTimeout(timer);
  if (status !== 0 || !output.includes('"ok":true'))
    throw new Error(`Desktop ${stage} test failed (${status})`);
}
console.log(
  `PASS: standalone desktop and process-restart persistence. Isolated fixtures retained at ${profile}`,
);
