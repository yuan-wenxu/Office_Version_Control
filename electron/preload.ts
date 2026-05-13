import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ovc", {
  selectWorkspace: () => ipcRenderer.invoke("dialog:selectWorkspace"),
  selectOfficeFiles: () => ipcRenderer.invoke("dialog:selectOfficeFiles"),
  selectOutputFile: (defaultPath?: string) => ipcRenderer.invoke("dialog:selectOutputFile", defaultPath),
  init: (workspace: string) => ipcRenderer.invoke("ovc:init", workspace),
  add: (workspace: string, files: string[]) => ipcRenderer.invoke("ovc:add", workspace, files),
  commit: (workspace: string, message: string) => ipcRenderer.invoke("ovc:commit", workspace, message),
  status: (workspace: string) => ipcRenderer.invoke("ovc:status", workspace),
  log: (workspace: string, file?: string) => ipcRenderer.invoke("ovc:log", workspace, file),
  diff: (workspace: string, file: string, from?: string, to?: string) =>
    ipcRenderer.invoke("ovc:diff", workspace, file, from, to),
  checkout: (workspace: string, file: string, version: string, output?: string) =>
    ipcRenderer.invoke("ovc:checkout", workspace, file, version, output)
});
