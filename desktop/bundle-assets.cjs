const fs = require("node:fs/promises");
const path = require("node:path");
const { assetPath } = require("./security.cjs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Keep this process on one complete renderer build. A local rebuild may delete
 * dist-desktop, but an open editor must still be able to load its lazy tag engine.
 * Only the small application bundle is retained; no user music or artwork is read. */
async function createAssetSnapshot(directory, csp) {
  const root = path.resolve(directory);
  const files = new Map();
  let bytes = 0;
  const collect = async (folder) => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const target = path.join(folder, entry.name);
      if (entry.isDirectory()) await collect(target);
      else if (entry.isFile()) {
        const data = await fs.readFile(target);
        bytes += data.length;
        if (bytes > 64 * 1024 * 1024)
          throw new Error("Application bundle exceeds the 64 MB snapshot limit.");
        files.set(target, data);
      }
      // Never follow links out of the packaged application directory.
    }
  };
  await collect(root);
  if (!files.has(path.join(root, "index.html")))
    throw new Error(
      "The desktop build is incomplete. Finish building Tag Maestro, then reopen it.",
    );

  return (request) => {
    const target = assetPath(root, request.url);
    const data = target && files.get(target);
    if (!data || !["GET", "HEAD"].includes(request.method))
      return new Response("Not found", { status: 404 });
    const headers = new Headers({
      "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
      "Content-Length": String(data.length),
      // A fresh process must not reuse HTML/code cached from an earlier build.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (csp) headers.set("Content-Security-Policy", csp);
    return new Response(request.method === "HEAD" ? null : data, { status: 200, headers });
  };
}
module.exports = { createAssetSnapshot };
