const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tagMaestroDesktop', {
  onMetadataProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('metadata:progress',listener);
    return () => ipcRenderer.removeListener('metadata:progress',listener);
  },
  metadataStatus: () => ipcRenderer.invoke('metadata:status'),
  lookupMetadata: (input) => ipcRenderer.invoke('metadata:lookup', input),
  setSpotifyToken: (token) => ipcRenderer.invoke('metadata:spotify-token', token),
  openMetadataSource: (url) => ipcRenderer.invoke('metadata:open-source', url),
  chooseRenameRoot: (name) => ipcRenderer.invoke('folders:choose-root', name),
  prepareFolderRenames: (token, plans) => ipcRenderer.invoke('folders:prepare', token, plans),
  commitFolderRenames: (transaction) => ipcRenderer.invoke('folders:commit', transaction),
  chooseNameLibrary: (includeSubfolders = false) => ipcRenderer.invoke('names:choose-root', includeSubfolders),
  pollNameLibrary: (id, offset) => ipcRenderer.invoke('names:poll', id, offset),
  pollNameSaveProgress: (id) => ipcRenderer.invoke('names:save-progress', id),
  stopNameLibrary: (id) => ipcRenderer.invoke('names:stop', id),
  releaseNameLibrary: (id) => ipcRenderer.invoke('names:release', id),
  renameLibraryNames: (id, plans, resolution) => ipcRenderer.invoke('names:rename', id, plans, resolution),
});
