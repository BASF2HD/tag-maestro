// Run with Electron. Uses synthetic rows and a fresh profile, never user music.
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tagmaestro-filename-ui-"));
app.setPath("userData", temporary);
app.on("window-all-closed", () => {});
let server;
let window;

app
  .whenReady()
  .then(async () => {
    process.chdir(root);
    const { createServer } = await import("vite");
    server = await createServer({
      configFile: path.join(root, "scripts/test-song-actions.config.ts"),
      cacheDir: path.join(temporary, "cache"),
      server: { host: "127.0.0.1", port: 0, strictPort: false, open: false },
    });
    await server.listen();
    window = new BrowserWindow({
      show: false,
      width: 1150,
      height: 850,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const errors = [];
    window.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3) errors.push(message);
    });
    await window.loadURL(
      `http://127.0.0.1:${server.httpServer.address().port}/scripts/test-filename-extraction.html`,
    );
    const evaluate = (expression) => window.webContents.executeJavaScript(expression);
    const waitFor = async (expression, description) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out: ${description}. Renderer errors: ${errors.join("; ")}`);
    };
    const settle = () =>
      evaluate(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
    const label = async (text) => {
      assert.ok(
        await evaluate(
          `(() => { const label = [...document.querySelectorAll('label')].find(label => label.textContent.trim() === ${JSON.stringify(text)}); label?.click(); return Boolean(label); })()`,
        ),
        `Missing label: ${text}`,
      );
      await settle();
    };
    const set = async (id, value) => {
      await evaluate(
        `(() => { const field = document.getElementById(${JSON.stringify(id)}); if (!field) throw new Error('Missing field'); const prototype = field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, ${JSON.stringify(String(value))}); field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`,
      );
      await settle();
    };
    const button = async (text) => {
      assert.ok(
        await evaluate(
          `(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)} && !button.disabled); button?.click(); return Boolean(button); })()`,
        ),
        `Missing enabled button: ${text}`,
      );
      await settle();
    };
    const preview = async (value) =>
      assert.ok(
        await evaluate(
          `[...document.querySelectorAll('[title]')].some(node => node.title === ${JSON.stringify(value)})`,
        ),
        `Missing preview: ${value}`,
      );
    await waitFor("Boolean(document.getElementById('converter-format'))", "converter mount");
    await label("Extract part of filename");
    await preview("Album: Aayusu Nooru");
    assert.ok(await evaluate("document.body.textContent.includes('1 skipped')"));
    await set("filename-extract-separator", "");
    assert.ok(await evaluate("Boolean(document.querySelector('[role=alert]'))"));
    assert.ok(
      await evaluate(
        "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Apply').disabled",
      ),
    );
    await set("filename-extract-separator", "-");
    await set("filename-extract-mode", "part");
    await set("filename-extract-position", 2);
    await set("filename-extract-target", "track");
    await preview("Track: 02");
    await label("Count from end");
    await set("filename-extract-position", 1);
    await set("filename-extract-target", "title");
    await preview("Title: Brahmadevan");
    await label("Count from end");
    await set("filename-extract-mode", "before-number");
    await set("filename-extract-target", "album");
    await preview("Album: Aayusu Nooru");
    await set("filename-extract-mode", "after-number");
    await preview("Album: Brahmadevan");
    await set("filename-extract-mode", "characters");
    await set("filename-extract-end", 12);
    await preview("Album: Aayusu Nooru");
    await set("filename-extract-mode", "before-separator");
    await preview("Album: Aayusu Nooru");
    fs.writeFileSync(
      path.join(temporary, "filename-extraction.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    window.setContentSize(1000, 580);
    await settle();
    const fits = await evaluate(
      `(() => { const dialog = document.querySelector('[role=dialog]').getBoundingClientRect(); const apply = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Apply').getBoundingClientRect(); return dialog.top >= 0 && dialog.bottom <= innerHeight && apply.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth; })()`,
    );
    assert.ok(fits, "Dialog and Apply button fit a short app window");
    await button("Apply");
    const changes = new Map(
      JSON.parse(await evaluate("document.querySelector('[role=status]').textContent")),
    );
    assert.equal(changes.size, 2);
    assert.deepEqual(changes.get("0"), { tags: { album: "Aayusu Nooru" } });
    assert.deepEqual(changes.get("1"), { tags: { album: "Other Album" } });
    assert.ok(!changes.has("2"), "Missing separator keeps the existing tag");
    await button("Open converter");
    await label("Format pattern");
    await set("converter-format", "%album% - %track% - %title%");
    await button("Apply");
    const pattern = new Map(
      JSON.parse(await evaluate("document.querySelector('[role=status]').textContent")),
    );
    assert.deepEqual(pattern.get("0"), {
      tags: { album: "Aayusu Nooru", track: "02", title: "Brahmadevan" },
    });
    await button("Open converter");
    await label("Extract part of filename");
    await label("Tag → Tag");
    await set("converter-format", "%filename%");
    await button("Apply");
    const tagCopy = new Map(
      JSON.parse(await evaluate("document.querySelector('[role=status]').textContent")),
    );
    assert.deepEqual(tagCopy.get("0"), {
      tags: { albumArtist: "Aayusu Nooru - 02 - Brahmadevan" },
    });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        ok: true,
        temporary,
        checks: [
          "separator",
          "number",
          "part-position",
          "count-from-end",
          "character-range",
          "destination-tag",
          "invalid-input",
          "safe-skip",
          "batch-apply",
          "small-window",
          "existing-patterns",
          "tag-to-tag",
        ],
      }),
    );
    window.destroy();
    await server.close();
    app.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    console.error("Fixture:", temporary);
    if (window && !window.isDestroyed()) window.destroy();
    if (server) await server.close();
    app.exit(1);
  });
