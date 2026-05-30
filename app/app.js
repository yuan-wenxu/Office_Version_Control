const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const FALLBACK_REFRESH_MS = 30000;
const WATCH_REFRESH_DEBOUNCE_MS = 250;
const WATCH_SETTLED_REFRESH_MS = 1800;

const state = {
  workspace: "",
  historyFile: "",
  history: [],
  trackedFiles: [],
  diffHistory: [],
  latestDiff: null,
  activeDiffTab: "text",
  autoRefreshTimer: null,
  watchRefreshTimer: null,
  watchSettledRefreshTimer: null,
  watchUnlisten: null,
  statusRefreshRunning: false,
  committableChanges: 0
};

const elements = {
  workspacePath: document.querySelector("#workspacePath"),
  messageLine: document.querySelector("#messageLine"),
  statusOutput: document.querySelector("#statusOutput"),
  commitMessage: document.querySelector("#commitMessage"),
  commitBtn: document.querySelector("#commitBtn"),
  historyList: document.querySelector("#historyList"),
  trackedFilesList: document.querySelector("#trackedFilesList"),
  diffFileLabel: document.querySelector("#diffFileLabel"),
  fromVersionSelect: document.querySelector("#fromVersionSelect"),
  toVersionSelect: document.querySelector("#toVersionSelect"),
  diffOutput: document.querySelector("#diffOutput"),
  diffTextTab: document.querySelector("#diffTextTab"),
  diffImagesTab: document.querySelector("#diffImagesTab")
};

updateUiScale();
window.addEventListener("resize", updateUiScale, { passive: true });
setupWorkspaceChangeListener();
updateCommitButtonState();

elements.commitMessage.addEventListener("input", updateCommitButtonState);

document.querySelector("#selectWorkspaceBtn").addEventListener("click", async () => {
  await run(async () => {
    const workspace = await invoke("select_workspace");
    if (!workspace) return;
    state.workspace = workspace;
    state.historyFile = "";
    state.history = [];
    state.trackedFiles = [];
    state.diffHistory = [];
    state.latestDiff = null;
    state.committableChanges = 0;
    updateCommitButtonState();
    elements.workspacePath.textContent = workspace;
    elements.diffFileLabel.textContent = "Choose a file in History.";
    renderTrackedFiles();
    renderHistory();
    renderDiffVersionOptions();
    localStorage.setItem("ovc.workspace", workspace);
    await startWorkspaceWatch();
    await refreshStatus();
    await refreshTrackedFiles();
    startFallbackRefresh();
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

elements.diffTextTab.addEventListener("click", () => {
  state.activeDiffTab = "text";
  renderDiff(state.latestDiff);
});

elements.diffImagesTab.addEventListener("click", () => {
  state.activeDiffTab = "images";
  renderDiff(state.latestDiff);
});

document.querySelector("#commitBtn").addEventListener("click", async () => {
  await run(async () => {
    if (elements.commitBtn.disabled) return;
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
    const diff = await invoke("diff_versions", {
      workspace: state.workspace,
      filePath,
      fromVersion,
      toVersion
    });
    state.latestDiff = diff;
    renderDiff(diff);
    setMessage("Diff loaded.");
  });
});

window.addEventListener("DOMContentLoaded", async () => {
  const workspace = localStorage.getItem("ovc.workspace");
  if (!workspace) return;
  state.workspace = workspace;
  elements.workspacePath.textContent = workspace;
  await run(async () => {
    await startWorkspaceWatch();
    await refreshStatus();
    await refreshTrackedFiles();
    renderHistory();
    renderDiffVersionOptions();
    startFallbackRefresh();
  });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    run(refreshStatus);
  }
});

async function refreshStatus() {
  requireWorkspace();
  if (state.statusRefreshRunning) return;
  state.statusRefreshRunning = true;
  try {
    const status = await invoke("status", { workspace: state.workspace });
    state.committableChanges = (status.staged || []).length + (status.modified || []).length;
    renderStatus(status);
    updateCommitButtonState();
  } finally {
    state.statusRefreshRunning = false;
  }
}

function renderStatus(status) {
  const modified = status.modified || [];
  elements.statusOutput.textContent = "";

  if (!modified.length) {
    const empty = document.createElement("div");
    empty.className = "status-empty";
    empty.textContent = "No modified tracked files.";
    elements.statusOutput.append(empty);
    return;
  }

  for (const item of modified) {
    const button = document.createElement("button");
    button.className = "status-item";
    button.type = "button";
    button.addEventListener("click", () => run(() => selectTrackedFile(item.sourcePath)));

    const title = document.createElement("strong");
    title.textContent = displayPath(item.sourcePath);

    const meta = document.createElement("small");
    meta.textContent = `${shortHash(item.previousHash)} -> ${shortHash(item.currentHash)}`;

    button.append(title, meta);
    elements.statusOutput.append(button);
  }
}

async function refreshTrackedFiles() {
  requireWorkspace();
  state.trackedFiles = await invoke("tracked_files", { workspace: state.workspace });
  renderTrackedFiles();
  if (state.historyFile && !state.trackedFiles.some((file) => file.sourcePath === state.historyFile)) {
    state.historyFile = "";
    state.history = [];
    state.diffHistory = [];
    state.latestDiff = null;
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
    renderDiffMessage("At least two versions are required to diff this file.");
  } else {
    renderDiffMessage("Choose versions, then click Diff.");
  }
}

async function selectTrackedFile(sourcePath, announce = true) {
  state.historyFile = sourcePath;
  state.latestDiff = null;
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
    renderDiffMessage(state.historyFile
      ? "At least two versions are required to diff this file."
      : "Choose a tracked file with at least two versions.");
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

function renderDiff(diff) {
  setDiffTabState();
  if (!diff) {
    renderDiffMessage(state.historyFile
      ? "Choose versions, then click Diff."
      : "Choose a tracked file with at least two versions.");
    return;
  }

  if (state.activeDiffTab === "images") {
    renderImageDiff(diff);
  } else {
    renderTextDiff(diff);
  }
}

function renderTextDiff(diff) {
  elements.diffOutput.textContent = "";
  elements.diffOutput.dataset.view = "text";

  const summary = document.createElement("div");
  summary.className = "diff-summary";

  const version = document.createElement("div");
  version.className = "diff-version";
  const title = document.createElement("strong");
  title.textContent = `${diff.from.id} -> ${diff.to.id}`;
  const meta = document.createElement("small");
  meta.textContent = `${diff.from.message || "No message"} -> ${diff.to.message || "No message"}`;
  version.append(title, meta);

  const added = document.createElement("div");
  added.className = "diff-stat";
  added.dataset.kind = "added";
  added.append(statStrong(`+${diff.addedLines}`), statSmall("added"));

  const removed = document.createElement("div");
  removed.className = "diff-stat";
  removed.dataset.kind = "removed";
  removed.append(statStrong(`-${diff.removedLines}`), statSmall("removed"));

  summary.append(version, added, removed);

  const list = document.createElement("div");
  list.className = "diff-list";

  if (!diff.lines.length || (!diff.addedLines && !diff.removedLines)) {
    const empty = document.createElement("div");
    empty.className = "diff-empty";
    empty.textContent = "No text changes detected between these versions.";
    list.append(empty);
  } else {
    for (const line of diff.lines) {
      list.append(renderDiffLine(line));
    }
  }

  elements.diffOutput.append(summary, list);
}

function renderImageDiff(diff) {
  elements.diffOutput.textContent = "";
  elements.diffOutput.dataset.view = "images";

  const summary = document.createElement("div");
  summary.className = "diff-summary diff-summary-images";

  const version = document.createElement("div");
  version.className = "diff-version";
  version.append(
    statStrong(`${diff.from.id} -> ${diff.to.id}`),
    statSmall(`${diff.from.message || "No message"} -> ${diff.to.message || "No message"}`)
  );

  const added = imageStat("+", diff.addedImages, "added");
  const removed = imageStat("-", diff.removedImages, "removed");
  const modified = imageStat("~", diff.modifiedImages, "changed");
  summary.append(version, added, removed, modified);

  const card = document.createElement("div");
  card.className = "image-diff-card";

  const changedImages = (diff.images || []).filter((image) => image.kind !== "unchanged");
  if (!changedImages.length) {
    const empty = document.createElement("div");
    empty.className = "diff-empty";
    empty.textContent = diff.unchangedImages
      ? `No image changes detected. ${diff.unchangedImages} image(s) are unchanged.`
      : "No images detected between these versions.";
    card.append(empty);
  } else {
    for (const image of changedImages) {
      card.append(renderImageDiffItem(image));
    }
  }

  elements.diffOutput.append(summary, card);
}

function renderImageDiffItem(image) {
  const item = document.createElement("article");
  item.className = "image-diff-item";
  item.dataset.kind = image.kind;

  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = displayMediaName(image.path);
  const badge = document.createElement("span");
  badge.className = "image-diff-badge";
  badge.textContent = image.kind;
  header.append(title, badge);

  const previews = document.createElement("div");
  previews.className = "image-preview-pair";

  if (image.kind !== "added") {
    previews.append(renderImagePreview("Before", image.oldDataUrl, image.oldSize, image.oldHash));
  }

  if (image.kind !== "removed") {
    previews.append(renderImagePreview("After", image.newDataUrl, image.newSize, image.newHash));
  }

  item.append(header, previews);
  return item;
}

function renderImagePreview(label, dataUrl, size, hash) {
  const preview = document.createElement("div");
  preview.className = "image-preview";

  const imageWrap = document.createElement("div");
  imageWrap.className = "image-preview-frame";
  if (dataUrl) {
    const image = document.createElement("img");
    image.src = dataUrl;
    image.alt = label;
    image.loading = "lazy";
    image.addEventListener("load", () => updateImagePairLayout(image));
    imageWrap.append(image);
  } else {
    const unsupported = document.createElement("span");
    unsupported.textContent = "Preview not supported";
    imageWrap.append(unsupported);
  }

  const meta = document.createElement("div");
  meta.className = "image-preview-meta";
  meta.append(statStrong(label), statSmall(`${formatBytes(size)} · ${shortHash(hash)}`));

  preview.append(imageWrap, meta);
  return preview;
}

function renderDiffLine(line) {
  const row = document.createElement("div");
  row.className = "diff-row";
  row.dataset.kind = line.kind;

  const oldLine = document.createElement("span");
  oldLine.className = "diff-line-number";
  oldLine.textContent = line.oldLine ?? "";

  const newLine = document.createElement("span");
  newLine.className = "diff-line-number";
  newLine.textContent = line.newLine ?? "";

  const marker = document.createElement("span");
  marker.className = "diff-marker";
  marker.textContent = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : "";

  const text = document.createElement("span");
  text.className = "diff-text";
  text.textContent = line.text || " ";

  row.append(oldLine, newLine, marker, text);
  return row;
}

function renderDiffMessage(message) {
  elements.diffOutput.textContent = "";
  const empty = document.createElement("div");
  empty.className = "diff-empty";
  empty.textContent = message;
  elements.diffOutput.append(empty);
}

function statStrong(value) {
  const strong = document.createElement("strong");
  strong.textContent = value;
  return strong;
}

function statSmall(value) {
  const small = document.createElement("small");
  small.textContent = value;
  return small;
}

function imageStat(prefix, count, label) {
  const item = document.createElement("div");
  item.className = "diff-stat";
  item.dataset.kind = label === "removed" ? "removed" : label === "added" ? "added" : "modified";
  item.append(statStrong(`${prefix}${count}`), statSmall(label));
  return item;
}

function setDiffTabState() {
  elements.diffTextTab.dataset.active = String(state.activeDiffTab === "text");
  elements.diffImagesTab.dataset.active = String(state.activeDiffTab === "images");
}

function updateImagePairLayout(image) {
  const pair = image.closest(".image-preview-pair");
  if (!pair) return;
  if (image.naturalHeight > image.naturalWidth) {
    pair.dataset.layout = "stacked";
    return;
  }

  const images = [...pair.querySelectorAll("img")];
  const hasPortrait = images.some((item) => item.complete && item.naturalHeight > item.naturalWidth);
  pair.dataset.layout = hasPortrait ? "stacked" : "side-by-side";
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function shortHash(value) {
  return value ? value.slice(0, 12) : "no hash";
}

function displayMediaName(path) {
  return path.split(/[\\/]/).pop() || path;
}

async function run(task) {
  try {
    await task();
  } catch (error) {
    setMessage(error?.message || String(error), true);
  }
}

async function setupWorkspaceChangeListener() {
  if (state.watchUnlisten) return;
  state.watchUnlisten = await listen("workspace-files-changed", (event) => {
    const payload = event.payload || {};
    if (!samePath(payload.workspace, state.workspace)) return;
    scheduleWatchRefresh();
  });
}

async function startWorkspaceWatch() {
  if (!state.workspace) return;
  await invoke("watch_workspace", { workspace: state.workspace });
}

function scheduleWatchRefresh() {
  if (state.watchRefreshTimer) {
    window.clearTimeout(state.watchRefreshTimer);
  }
  if (state.watchSettledRefreshTimer) {
    window.clearTimeout(state.watchSettledRefreshTimer);
  }

  state.watchRefreshTimer = window.setTimeout(() => {
    run(refreshStatus);
  }, WATCH_REFRESH_DEBOUNCE_MS);

  state.watchSettledRefreshTimer = window.setTimeout(() => {
    run(async () => {
      await refreshStatus();
      setMessage("File changes checked.");
    });
  }, WATCH_SETTLED_REFRESH_MS);
}

function startFallbackRefresh() {
  if (state.autoRefreshTimer) {
    window.clearInterval(state.autoRefreshTimer);
  }
  state.autoRefreshTimer = window.setInterval(() => {
    if (!state.workspace || document.visibilityState !== "visible") return;
    run(refreshStatus);
  }, FALLBACK_REFRESH_MS);
}

function updateCommitButtonState() {
  const hasMessage = elements.commitMessage.value.trim().length > 0;
  const canCommit = Boolean(state.workspace) && state.committableChanges > 0 && hasMessage;
  elements.commitBtn.disabled = !canCommit;
  elements.commitBtn.title = canCommit
    ? "Commit detected changes"
    : "Enter a commit message after tracked files change.";
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

function samePath(left, right) {
  if (!left || !right) return false;
  return left.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
    === right.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function updateUiScale() {
  const widthScale = window.innerWidth / 1280;
  const heightScale = window.innerHeight / 820;
  const scale = Math.min(1.5, Math.max(0.92, Math.min(widthScale, heightScale * 1.15)));
  document.documentElement.style.setProperty("--ui-scale", scale.toFixed(3));
}
