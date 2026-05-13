const state = {
  workspace: "",
  history: []
};

const elements = {
  workspacePath: document.querySelector("#workspacePath"),
  messageLine: document.querySelector("#messageLine"),
  statusOutput: document.querySelector("#statusOutput"),
  commitMessage: document.querySelector("#commitMessage"),
  historyList: document.querySelector("#historyList"),
  filterFileInput: document.querySelector("#filterFileInput"),
  diffOutput: document.querySelector("#diffOutput")
};

document.querySelector("#selectWorkspaceBtn").addEventListener("click", async () => {
  await run(async () => {
    const workspace = await window.ovc.selectWorkspace();
    if (!workspace) return;
    state.workspace = workspace;
    elements.workspacePath.textContent = workspace;
    setMessage("Workspace selected.");
    await refreshStatus();
    await refreshLog();
  });
});

document.querySelector("#initBtn").addEventListener("click", async () => {
  await run(async () => {
    requireWorkspace();
    await window.ovc.init(state.workspace);
    setMessage("Repository initialized.");
    await refreshStatus();
  });
});

document.querySelector("#selectFilesBtn").addEventListener("click", async () => {
  await run(async () => {
    requireWorkspace();
    const files = await window.ovc.selectOfficeFiles();
    if (!files.length) return;
    const staged = await window.ovc.add(state.workspace, files);
    setMessage(`Staged ${staged.length} file(s).`);
    await refreshStatus();
  });
});

document.querySelector("#statusBtn").addEventListener("click", () => run(refreshStatus));
document.querySelector("#logBtn").addEventListener("click", () => run(refreshLog));

document.querySelector("#commitBtn").addEventListener("click", async () => {
  await run(async () => {
    requireWorkspace();
    const message = elements.commitMessage.value.trim();
    if (!message) throw new Error("Commit message is required.");
    const records = await window.ovc.commit(state.workspace, message);
    elements.commitMessage.value = "";
    setMessage(`Committed ${records.length} version(s).`);
    await refreshStatus();
    await refreshLog();
  });
});

document.querySelector("#diffBtn").addEventListener("click", async () => {
  await run(async () => {
    requireWorkspace();
    const file = elements.filterFileInput.value.trim();
    if (!file) throw new Error("Enter a file path before diffing.");
    elements.diffOutput.textContent = await window.ovc.diff(state.workspace, file);
    setMessage("Diff loaded.");
  });
});

async function refreshStatus() {
  requireWorkspace();
  const status = await window.ovc.status(state.workspace);
  const lines = [];

  if (!status.staged.length && !status.modified.length && !status.missing.length) {
    lines.push("nothing to commit, working tree clean");
  }

  if (status.staged.length) {
    lines.push("Changes to be committed:");
    for (const item of status.staged) lines.push(`  staged:   ${item.sourcePath}`);
  }

  if (status.modified.length) {
    lines.push("Changes not staged for commit:");
    for (const item of status.modified) lines.push(`  modified: ${item.sourcePath}`);
  }

  if (status.missing.length) {
    lines.push("Tracked files missing:");
    for (const item of status.missing) lines.push(`  deleted:  ${item.sourcePath}`);
  }

  elements.statusOutput.textContent = lines.join("\n");
}

async function refreshLog() {
  requireWorkspace();
  const file = elements.filterFileInput.value.trim();
  state.history = await window.ovc.log(state.workspace, file || undefined);
  renderHistory();
}

function renderHistory() {
  if (!state.history.length) {
    elements.historyList.textContent = "No history loaded.";
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
    checkout.className = "secondary";
    checkout.textContent = "Checkout";
    checkout.addEventListener("click", () => {
      run(async () => {
        const output = await window.ovc.selectOutputFile(record.sourcePath);
        if (!output) return;
        const restored = await window.ovc.checkout(state.workspace, record.sourcePath, record.id, output);
        setMessage(`Restored ${restored}`);
      });
    });

    item.append(id, meta, checkout);
    elements.historyList.append(item);
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
  elements.messageLine.style.color = isError ? "#b42318" : "#677084";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
