const path = require('node:path');
const { appURL } = require('./security.cjs');
function canCheckPermission(contents, permission, origin, details, mainContents) {
  if (!mainContents || !appURL(mainContents.getURL()) || !appURL(origin)) return false;
  if (!['fileSystem', 'clipboard-sanitized-write'].includes(permission)) return false;
  if (contents === mainContents) return true;
  // Electron's external FSA grant status check deliberately passes nullptr for
  // WebContents. Chromium still owns the user-picked handle capability; validate
  // its fixed app origin and concrete filesystem path, not a missing window.
  return contents === null && permission === 'fileSystem' &&
    typeof details?.filePath === 'string' && path.isAbsolute(details.filePath);
}
module.exports = { canCheckPermission };
