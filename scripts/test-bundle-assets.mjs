import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
const { createAssetSnapshot } = createRequire(import.meta.url)("../desktop/bundle-assets.cjs");
const temporary = await mkdtemp(path.join(os.tmpdir(), "tagmaestro-bundle-test-"));
const root = path.join(temporary, "bundle");
const request = (url, method = "GET") => new Request(url, { method });
try {
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(
    path.join(root, "index.html"),
    '<script type="module" src="/assets/old-main.js"></script>',
  );
  await writeFile(path.join(root, "assets", "old-main.js"), 'export const version="old"');
  await writeFile(path.join(root, "assets", "old-lazy.js"), 'export const tags="old-tag-engine"');
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  await writeFile(path.join(root, "assets", "old-engine.wasm"), wasm);
  const serve = await createAssetSnapshot(root, "default-src 'none'");
  // Reproduce Vite emptyOutDir: the original lazy chunks disappear mid-session.
  await rm(root, { recursive: true });
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(path.join(root, "index.html"), "<p>New renderer build</p>");
  await writeFile(path.join(root, "assets", "new-lazy.js"), 'export const tags="new-tag-engine"');
  assert.match(await serve(request("tagmaestro://app/")).text(), /old-main/);
  assert.match(
    await serve(request("tagmaestro://app/assets/old-lazy.js")).text(),
    /old-tag-engine/,
  );
  const asset = serve(request("tagmaestro://app/assets/old-engine.wasm"));
  assert.equal(asset.headers.get("Content-Type"), "application/wasm");
  assert.deepEqual(new Uint8Array(await asset.arrayBuffer()), wasm);
  assert.equal(asset.headers.get("Cache-Control"), "no-store");
  assert.equal(asset.headers.get("Content-Security-Policy"), "default-src 'none'");
  assert.equal(
    serve(request("tagmaestro://app/assets/new-lazy.js")).status,
    404,
    "An open process must not mix builds",
  );
  const head = serve(request("tagmaestro://app/assets/old-lazy.js", "HEAD"));
  assert.equal(await head.text(), "");
  assert.ok(Number(head.headers.get("Content-Length")) > 0);
  for (const url of [
    "tagmaestro://app/%2e%2e%2fsecret",
    "tagmaestro://other/assets/old-lazy.js",
    "https://example.com/",
    "tagmaestro://app/assets/missing.js",
  ])
    assert.equal(serve(request(url)).status, 404);
  assert.equal(serve(request("tagmaestro://app/", "POST")).status, 404);
  const next = await createAssetSnapshot(root);
  assert.match(await next(request("tagmaestro://app/")).text(), /New renderer/);
  assert.equal(next(request("tagmaestro://app/assets/old-lazy.js")).status, 404);
  assert.match(await next(request("tagmaestro://app/assets/new-lazy.js")).text(), /new-tag-engine/);
  console.log(
    "PASS: lazy JS/WASM survive build deletion, no mixed builds, fresh-start assets, HEAD/MIME/cache/security rules.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
