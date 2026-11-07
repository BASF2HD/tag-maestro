// Real Chromium dynamic import and WASM fetch after deleting a disposable build.
const { app, BrowserWindow, protocol, session } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { createAssetSnapshot } = require("../desktop/bundle-assets.cjs");
let temporary, window;
protocol.registerSchemesAsPrivileged([
  {
    scheme: "tagmaestro",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
app
  .whenReady()
  .then(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "tagmaestro-chunks-ui-"));
    const root = path.join(temporary, "bundle");
    await fs.mkdir(path.join(root, "assets"), { recursive: true });
    await fs.writeFile(
      path.join(root, "index.html"),
      '<p>Old editor stays open</p><script type="module" src="/assets/main-old.js"></script>',
    );
    await fs.writeFile(
      path.join(root, "assets", "main-old.js"),
      'window.loadEngine = () => import("./engine-old.js");',
    );
    await fs.writeFile(
      path.join(root, "assets", "engine-old.js"),
      'import {version} from "./dependency-old.js"; export const engine=version; export const wasmURL=new URL("./engine-old.wasm",import.meta.url).href;',
    );
    await fs.writeFile(
      path.join(root, "assets", "dependency-old.js"),
      'export const version="old-tag-engine";',
    );
    await fs.writeFile(
      path.join(root, "assets", "engine-old.wasm"),
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    );
    const serve = await createAssetSnapshot(
      root,
      "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'",
    );
    const ses = session.fromPartition("test-build-snapshot");
    ses.protocol.handle("tagmaestro", serve);
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    await window.loadURL("tagmaestro://app/");
    await fs.rm(root, { recursive: true });
    await fs.mkdir(path.join(root, "assets"), { recursive: true });
    await fs.writeFile(path.join(root, "index.html"), "<p>New editor</p>");
    await fs.writeFile(path.join(root, "assets", "engine-new.js"), 'export const engine="new"');
    const result = await window.webContents.executeJavaScript(
      `(async()=>{const engine=await window.loadEngine();const response=await fetch(engine.wasmURL);await WebAssembly.instantiateStreaming(response);return engine.engine})()`,
    );
    assert.equal(result, "old-tag-engine");
    assert.equal(
      await window.webContents.executeJavaScript(
        'document.body.textContent.includes("Old editor stays open")',
      ),
      true,
    );
    console.log(
      "PASS: running Electron editor loads its original lazy module, dependency and WASM after a clean rebuild.",
    );
    window.destroy();
    await fs.rm(temporary, { recursive: true, force: true });
    app.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    window?.destroy();
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    app.exit(1);
  });
