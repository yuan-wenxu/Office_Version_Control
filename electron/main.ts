import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { VersionManager } from "../src/core/versionManager.js";
import { getRepositoryPaths } from "../src/storage/repositoryPaths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    title: "OVC",
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.loadFile(path.join(__dirname, "../../renderer/index.html"));
}

function managerFor(workspace: string): VersionManager {
  return new VersionManager(getRepositoryPaths(path.join(workspace, ".office-vcs")));
}

ipcMain.handle("dialog:selectWorkspace", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose workspace",
    properties: ["openDirectory", "createDirectory"]
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("dialog:selectOfficeFiles", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose Office files",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Office files", extensions: ["docx", "xlsx", "pptx"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("dialog:selectOutputFile", async (_event, defaultPath?: string) => {
  const result = await dialog.showSaveDialog({
    title: "Restore version as",
    defaultPath
  });

  return result.canceled ? null : result.filePath;
});

ipcMain.handle("ovc:init", async (_event, workspace: string) => {
  await managerFor(workspace).init();
  return true;
});

ipcMain.handle("ovc:add", async (_event, workspace: string, files: string[]) => {
  const manager = managerFor(workspace);
  const staged = [];

  for (const file of files) {
    staged.push(await manager.add(file));
  }

  return staged;
});

ipcMain.handle("ovc:commit", async (_event, workspace: string, message: string) => {
  return managerFor(workspace).commit({ message });
});

ipcMain.handle("ovc:status", async (_event, workspace: string) => {
  return managerFor(workspace).status();
});

ipcMain.handle("ovc:log", async (_event, workspace: string, file?: string) => {
  return managerFor(workspace).log(file || undefined);
});

ipcMain.handle("ovc:diff", async (_event, workspace: string, file: string, from?: string, to?: string) => {
  return managerFor(workspace).diff(file, { from: from || undefined, to: to || undefined });
});

ipcMain.handle("ovc:checkout", async (_event, workspace: string, file: string, version: string, output?: string) => {
  return managerFor(workspace).checkout(file, { version, output: output || undefined, force: true });
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
