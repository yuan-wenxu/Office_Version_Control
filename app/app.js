const { invoke } = window.__TAURI__.core;

const state = {
  workspace: "",
  historyFile: "",
  history: [],
  trackedFiles: [],
  diffHistory: []
};

const elements = {
  workspacePath: document.querySelector("#workspacePath"),
  messageLine: document.querySelector("#messageLine"),
  statusOutput: document.querySelector("#statusOutput"),
  commitMessage: document.querySelector("#commitMessage"),
  historyList: document.querySelector("#historyList"),
  trackedFilesList: document.querySelector("#trackedFilesList"),
  diffFileLabel: document.querySelector("#diffFileLabel"),
  fromVersionSelect: document.querySelector("#fromVersionSelect"),
  toVersionSelect: document.querySelector("#toVersionSelect"),
  diffOutput: document.querySelector("#diffOutput")
};

document.querySelector("#selectWorkspaceBtn").addEventListener("click", async () => {
  await run(async () => {
    const workspace = await invoke("select_workspace");
    if (!workspace) return;
    state.workspace = workspace;
    state.historyFile = "";
    state.history = [];
    state.trackedFiles = [];
    state.diffHistory = [];
    elements.workspacePath.textContent = workspace;
    elements.diffFileLabel.textContent = "Choose a file in History.";
    renderTrackedFiles();
    renderHistory();
    renderDiffVersionOptions();
    localStorage.setItem("ovc.workspace", workspace);
    await refreshStatus();
    await refreshTrackedFiles();
    setMessage("Workspace selected.");
  });
});

document.querySelector("#initBtn").addEventListener("click", async () => {
  await run(async () => {
    requireWorkspace();
    await invoke("init_repo", { workspace: state.workspace });
    await refreshStatus();
    await refreshTrackedFiles();
    setMessage("Repository initialized.");
  });
});

document.querySelector("#selectFilesBtn").addEventListener("click", async () => {
  await run(async () => {
    requireWorkspace();
    const files = await invoke("select_office_files");
    if (!files.length) return;
    const staged = await invoke("track_files", { workspace: state.workspace, files });
    await refreshStatus();
    await refreshTrackedFiles();
    setMessage(`Tracking ${staged.length} new file(s).`);
  });
});

document.querySelector("#statusBtn").addEventListener("click", () => run(refreshStatus));
document.querySelector("#logBtn").addEventListener("click", async () => {
  await run(async () => {
    await refreshTrackedFiles();
    if (state.historyFile) {
      await selectTrackedFile(state.historyFile, false);
    }
    setMessage("History refreshed.");
  });
});

document.querySelector("#commitBtn").addEventListener("click", async () => {
  await run(async () => {
    requireWorkspace();
    const message = elements.commitMessage.value.trim();
    if (!message) throw new Error("Commit message is required.");
    const records = await invoke("commit_detected", { workspace: state.workspace, message });
    elements.commitMessage.value = "";
    await refreshStatus();
    await refreshTrackedFiles();
    if (state.historyFile) await selectTrackedFile(state.historyFile, false);
    setMessage(`Committed ${records.length} detected change(s).`);
  });
});

document.querySelector("#diffBtn").addEventListener("click", async () => {
  await run(async () => {
    requireWorkspace();
    const filePath = state.historyFile;
    if (!filePath) throw new Error("Choose a file in History before diffing.");
    const fromVersion = elements.fromVersionSelect.value;
    const toVersion = elements.toVersionSelect.value;
    if (!fromVersion || !toVersion) throw new Error("Choose two versions before diffing.");
    if (fromVersion === toVersion) throw new Error("Choose two different versions.");
    elements.diffOutput.textContent = await invoke("diff_versions", {
      workspace: state.workspace,
      filePath,
      fromVersion,
      toVersion
    });
    setMessage("Diff loaded.");
  });
});

window.addEventListener("DOMContentLoaded", async () => {
  const workspace = localStorage.getItem("ovc.workspace");
  if (!workspace) return;
  state.workspace = workspace;
  elements.workspacePath.textContent = workspace;
  await run(async () => {
    await refreshStatus();
    await refreshTrackedFiles();
    renderHistory();
    renderDiffVersionOptions();
  });
});

async function refreshStatus() {
  requireWorkspace();
  const status = await invoke("status", { workspace: state.workspace });
  const lines = [];

  if (!status.staged.length && !status.modified.length && !status.missing.length) {
    lines.push("nothing to commit, working tree clean");
  }

  if (status.staged.length) {
    lines.push("New files ready to commit:");
    for (const item of status.staged) lines.push(`  staged:   ${item.sourcePath}`);
  }

  if (status.modified.length) {
    lines.push("Detected tracked file changes:");
    for (const item of status.modified) lines.push(`  modified: ${item.sourcePath}`);
  }

  if (status.missing.length) {
    lines.push("Tracked files missing:");
    for (const item of status.missing) lines.push(`  missing:  ${item.sourcePath}`);
  }

  elements.statusOutput.textContent = lines.join("\n");
}

async function refreshTrackedFiles() {
  requireWorkspace();
  state.trackedFiles = await invoke("tracked_files", { workspace: state.workspace });
  renderTrackedFiles();
  if (state.historyFile && !state.trackedFiles.some((file) => file.sourcePath === state.historyFile)) {
    state.historyFile = "";
    state.history = [];
    state.diffHistory = [];
    elements.diffFileLabel.textContent = "Choose a file in History.";
    renderHistory();
    renderDiffVersionOptions();
  }
}

async function refreshLog() {
  requireWorkspace();
  const filePath = state.historyFile;
  if (!filePath) throw new Error("Choose a file for history.");
  state.history = await invoke("log", { workspace: state.workspace, filePath });
  renderHistory();
}

async function refreshDiffVersions() {
  requireWorkspace();
  const filePath = state.historyFile;
  if (!filePath) throw new Error("Choose a file for diff.");
  state.diffHistory = await invoke("log", { workspace: state.workspace, filePath });
  renderDiffVersionOptions();
  if (state.diffHistory.length < 2) {
    elements.diffOutput.textContent = "At least two versions are required to diff this file.";
  } else {
    elements.diffOutput.textContent = "Choose versions, then click Diff.";
  }
}

async function selectTrackedFile(sourcePath, announce = true) {
  state.historyFile = sourcePath;
  const label = displayPath(sourcePath);
  elements.diffFileLabel.textContent = label;
  renderTrackedFiles();
  await refreshLog();
  await refreshDiffVersions();
  if (announce) setMessage(`Loaded ${label}.`);
}

function renderTrackedFiles() {
  if (!state.trackedFiles.length) {
    elements.trackedFilesList.textContent = "No tracked files.";
    return;
  }

  elements.trackedFilesList.textContent = "";
  for (const file of state.trackedFiles) {
    const button = document.createElement("button");
    button.className = "tracked-file";
    button.type = "button";
    button.dataset.selected = String(file.sourcePath === state.historyFile);
    button.addEventListener("click", () => run(() => selectTrackedFile(file.sourcePath)));

    const name = document.createElement("strong");
    name.textContent = file.originalName;

    const meta = document.createElement("small");
    const versionText = file.versions === 1 ? "1 version" : `${file.versions} versions`;
    const stagedText = file.staged ? " · staged" : "";
    meta.textContent = `${file.sourcePath} · ${versionText}${stagedText}`;

    button.append(name, meta);
    elements.trackedFilesList.append(button);
  }
}

function renderHistory() {
  if (!state.history.length) {
    elements.historyList.textContent = state.historyFile
      ? "No committed versions for this file yet."
      : "Choose a tracked file to view versions.";
    return;
  }

  elements.historyList.textContent = "";
  for (const record of state.history) {
    const item = document.createElement("div");
    item.className = "history-item";

    const id = document.createElement("strong");
    id.textContent = record.id;

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.innerHTML = `<div>${escapeHtml(record.originalName)} - ${escapeHtml(record.message || "No message")}</div>
      <small>${escapeHtml(record.createdAt)} · ${escapeHtml(record.hash.slice(0, 12))}</small>`;

    const checkout = document.createElement("button");
    checkout.textContent = "Checkout";
    checkout.addEventListener("click", () => {
      run(async () => {
        const output = await invoke("select_output_file", { defaultPath: record.sourcePath });
        if (!output) return;
        const restored = await invoke("checkout_version", {
          workspace: state.workspace,
          filePath: record.sourcePath,
          version: record.id,
          output
        });
        setMessage(`Restored ${restored}`);
      });
    });

    item.append(id, meta, checkout);
    elements.historyList.append(item);
  }
}

function renderDiffVersionOptions() {
  elements.fromVersionSelect.textContent = "";
  elements.toVersionSelect.textContent = "";

  if (!state.diffHistory.length) {
    elements.fromVersionSelect.append(new Option("From", ""));
    elements.toVersionSelect.append(new Option("To", ""));
    elements.diffOutput.textContent = state.historyFile
      ? "At least two versions are required to diff this file."
      : "Choose a tracked file with at least two versions.";
    return;
  }

  const records = [...state.diffHistory].sort((a, b) => versionNumber(a.id) - versionNumber(b.id));
  for (const record of records) {
    const label = `${record.id} - ${record.message || "No message"}`;
    elements.fromVersionSelect.append(new Option(label, record.id));
    elements.toVersionSelect.append(new Option(label, record.id));
  }

  if (records.length >= 2) {
    elements.fromVersionSelect.value = records[records.length - 2].id;
    elements.toVersionSelect.value = records[records.length - 1].id;
  }
}

async function run(task) {
  try {
    await task();
  } catch (error) {
    setMessage(error?.message || String(error), true);
  }
}

function requireWorkspace() {
  if (!state.workspace) throw new Error("Choose a workspace first.");
}

function setMessage(message, isError = false) {
  elements.messageLine.textContent = message;
  elements.messageLine.dataset.error = String(isError);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function versionNumber(id) {
  const match = /^v(\d+)$/.exec(id);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function displayPath(filePath) {
  if (!state.workspace) return filePath;
  const normalizedWorkspace = state.workspace.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  const normalizedFile = filePath.replaceAll("\\", "/");
  if (normalizedFile.toLowerCase().startsWith(`${normalizedWorkspace}/`)) {
    return normalizedFile.slice(normalizedWorkspace.length + 1);
  }
  return filePath;
}
