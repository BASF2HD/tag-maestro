const path = require("node:path");
const ORIGIN = "tagmaestro://app";
function appURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === "tagmaestro:" && url.host === "app" && !url.username && !url.password;
  } catch {
    return false;
  }
}
function assetPath(root, value) {
  if (!appURL(value)) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(value).pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\\") || pathname.includes("\0")) return null;
  const candidate = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? candidate : null;
}
module.exports = { ORIGIN, appURL, assetPath };
