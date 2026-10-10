const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tagMaestroDesktop', {
  chooseRenameRoot: (name) => ipcRenderer.invoke('folders:choose-root', name),
  prepareFolderRenames: (token, plans) => ipcRenderer.invoke('folders:prepare', token, plans),
  commitFolderRenames: (transaction) => ipcRenderer.invoke('folders:commit', transaction),
  chooseNameLibrary: () => ipcRenderer.invoke('names:choose-root'),
  pollNameLibrary: (id, offset) => ipcRenderer.invoke('names:poll', id, offset),
  pollNameSaveProgress: (id) => ipcRenderer.invoke('names:save-progress', id),
  stopNameLibrary: (id) => ipcRenderer.invoke('names:stop', id),
  releaseNameLibrary: (id) => ipcRenderer.invoke('names:release', id),
  renameLibraryNames: (id, plans, resolution) => ipcRenderer.invoke('names:rename', id, plans, resolution),
});
