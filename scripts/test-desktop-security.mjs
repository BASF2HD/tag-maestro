import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
const { appURL, assetPath } = createRequire(import.meta.url)("../desktop/security.cjs");
const root = path.resolve("dist-desktop");
assert.equal(appURL("tagmaestro://app/"), true);
for (const url of [
  "https://evil.test",
  "tagmaestro://evil/",
  "tagmaestro://user@app/",
  "file:///etc/passwd",
  "invalid",
])
  assert.equal(appURL(url), false);
assert.equal(assetPath(root, "tagmaestro://app/"), path.join(root, "index.html"));
assert.equal(assetPath(root, "tagmaestro://app/assets/test.js"), path.join(root, "assets/test.js"));
for (const url of [
  "tagmaestro://app/%2e%2e%2fsecret",
  "tagmaestro://app/%5csecret",
  "tagmaestro://app/%00",
  "tagmaestro://app/%ZZ",
  "https://evil.test/",
])
  assert.equal(assetPath(root, url), null);
console.log("PASS: app origin and bundle path confinement.");
