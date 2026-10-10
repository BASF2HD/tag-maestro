const { app, BrowserWindow, Menu, protocol, session, net, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { ORIGIN, appURL, assetPath } = require("./security.cjs");
const { canCheckPermission } = require('./permissions.cjs');
const test = process.argv.includes("--desktop-self-test");
const stage = process.argv.find((arg) => arg.startsWith("--test-stage="))?.split("=")[1] || "write";
const profile = process.argv
  .find((arg) => arg.startsWith("--test-profile="))
  ?.slice("--test-profile=".length);
if (test) {
  if (!profile || !path.isAbsolute(profile))
    throw new Error("Self-test requires an isolated absolute test profile");
  app.setPath("userData", profile);
}
app.setName("Tag Maestro");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "tagmaestro",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
const CSP =
  "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'";
let window;
const folderRenames = new (require('./folder-renames.cjs').FolderRenames)();
const nameInventory = new (require('./name-inventory.cjs').NameInventory)();
let activeInventory;
function trusted(event) {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !appURL(event.senderFrame.url)) throw new Error('Unauthorized folder operation');
}
ipcMain.handle('folders:choose-root', async (event, expectedName) => {
  trusted(event);
  if (typeof expectedName !== 'string' || !expectedName) throw new Error('Missing library name');
  const result = await dialog.showOpenDialog(window, {
    title: `Choose the loaded ${expectedName} library folder to enable original folder renaming`,
    properties: ['openDirectory'], buttonLabel: 'Allow folder renaming',
  });
  if (result.canceled || !result.filePaths.length) return null;
  if (path.basename(result.filePaths[0]) !== expectedName) throw new Error(`Choose the loaded ${expectedName} folder, not an album inside it`);
  return folderRenames.grant(result.filePaths[0]);
});
ipcMain.handle('folders:prepare', (event, token, plans) => { trusted(event); return folderRenames.prepare(token, plans); });
ipcMain.handle('folders:commit', (event, transaction) => { trusted(event); return folderRenames.commit(transaction); });
ipcMain.handle('names:choose-root', async (event) => {
  trusted(event);
  const result = await dialog.showOpenDialog(window, { title: 'Choose a library for fast folder and archive renaming', properties: ['openDirectory'], buttonLabel: 'Load names only' });
  if (result.canceled || !result.filePaths.length) return null;
  if (activeInventory) await nameInventory.release(activeInventory);
  const job = await nameInventory.start(result.filePaths[0]);
  activeInventory = job.id;
  return job;
});
ipcMain.handle('names:poll', (event, id, offset) => { trusted(event); return nameInventory.poll(id, offset); });
ipcMain.handle('names:save-progress', (event, id) => { trusted(event); return nameInventory.pollSaveProgress(id); });
ipcMain.handle('names:stop', (event, id) => { trusted(event); nameInventory.stop(id); });
ipcMain.handle('names:release', async (event, id) => { trusted(event); await nameInventory.release(id); if (activeInventory === id) activeInventory = undefined; });
ipcMain.handle('names:rename', (event, id, plans, resolution) => { trusted(event); return nameInventory.rename(id, plans, resolution); });
async function createWindow() {
  window = new BrowserWindow({
    title: "Tag Maestro",
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    show: !test,
    backgroundColor: "#151619",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: "persist:tagmaestro",
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!appURL(url)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("render-process-gone", (_event, details) =>
    console.error("Renderer stopped:", details.reason),
  );
  await window.loadURL(`${ORIGIN}/${test ? `?selftest=${stage}` : ""}`);
  if (test) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const result = await window.webContents.executeJavaScript(
        "document.documentElement.dataset.desktopTest || ''",
      );
      if (result) {
        console.log(`DESKTOP_SELF_TEST ${result}`);
        await session.fromPartition("persist:tagmaestro").flushStorageData();
        app.exit(JSON.parse(result).ok ? 0 : 1);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Desktop self-test timed out");
  }
}
app
  .whenReady()
  .then(async () => {
    const ses = session.fromPartition("persist:tagmaestro");
    const root = path.join(app.getAppPath(), "dist-desktop");
    ses.protocol.handle("tagmaestro", async (request) => {
      const target = assetPath(root, request.url);
      if (!target || !["GET", "HEAD"].includes(request.method))
        return new Response("Not found", { status: 404 });
      try {
        if (!(await fs.stat(target)).isFile()) return new Response("Not found", { status: 404 });
        const response = await net.fetch(pathToFileURL(target).href);
        const headers = new Headers(response.headers);
        headers.set("Content-Security-Policy", CSP);
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(request.method === "HEAD" ? null : response.body, {
          status: response.status,
          headers,
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });
    // FSA capabilities still come exclusively from Chromium's user-chosen file/folder pickers.
    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(
        contents === window?.webContents &&
          appURL(contents.getURL()) &&
          appURL(details.requestingUrl || contents.getURL()) &&
          ["fileSystem", "clipboard-sanitized-write"].includes(permission),
      );
    });
    ses.setPermissionCheckHandler((contents, permission, origin, details) =>
      canCheckPermission(contents, permission, origin, details, window?.webContents),
    );
    ses.on("file-system-access-restricted", (_event, _details, callback) => callback("deny"));
    ses.webRequest.onBeforeRequest((details, callback) => {
      callback({
        cancel:
          !appURL(details.url) &&
          !details.url.startsWith("blob:") &&
          !details.url.startsWith("data:"),
      });
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
        {
          label: "File",
          submenu: [
            { role: "close" },
            ...(process.platform !== "darwin" ? [{ role: "quit" }] : []),
          ],
        },
        { role: "editMenu" },
        {
          label: "View",
          submenu: [
            { role: "reload" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { role: "togglefullscreen" },
          ],
        },
        { role: "windowMenu" },
      ]),
    );
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(fail);
    });
  })
  .catch(fail);
function fail(error) {
  console.error(error);
  if (!test) dialog.showErrorBox("Tag Maestro could not start", String(error));
  app.exit(1);
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
