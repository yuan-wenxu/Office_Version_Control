const apiBase = "https://localhost:38655";

const elements = {
  workspace: document.querySelector("#workspaceInput"),
  filePath: document.querySelector("#filePathInput"),
  message: document.querySelector("#messageInput"),
  saveVersion: document.querySelector("#saveVersionBtn"),
  history: document.querySelector("#historyList")
};

Office.onReady(() => {
  // Restore collapsed / expanded state across sessions.
  const collapseBtn = document.querySelector("#collapseBtn");
  if (localStorage.getItem("ovc.collapsed") === "true") {
    document.body.classList.add("collapsed");
    collapseBtn.innerHTML = "&#43;";
    collapseBtn.title = "Expand panel";
  }

  detectCurrentFile(); // auto-fills workspace from current file's folder
  if (!elements.workspace.value) {
    // fallback: restore last manually saved workspace
    const saved = localStorage.getItem("ovc.workspace");
    if (saved) elements.workspace.value = saved;
  }
  updateSaveButtonState();
});

document.querySelector("#collapseBtn").addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("collapsed");
  const btn = document.querySelector("#collapseBtn");
  btn.innerHTML = collapsed ? "&#43;" : "&#8722;";
  btn.title    = collapsed ? "Expand panel" : "Minimize panel";
  localStorage.setItem("ovc.collapsed", collapsed);
});

document.querySelector("#detectBtn").addEventListener("click", detectCurrentFile);
elements.saveVersion.addEventListener("click", () => run(saveVersion));
document.querySelector("#historyBtn").addEventListener("click", () => run(loadHistory));
elements.workspace.addEventListener("change", () => {
  localStorage.setItem("ovc.workspace", elements.workspace.value.trim());
  updateSaveButtonState();
});
elements.workspace.addEventListener("input", updateSaveButtonState);
elements.filePath.addEventListener("input", updateSaveButtonState);
elements.message.addEventListener("input", updateSaveButtonState);
updateSaveButtonState();

async function saveVersion() {
  if (elements.saveVersion.disabled) return;
  const workspace = requireValue(elements.workspace, "Workspace folder is required.");
  const filePath = requireValue(elements.filePath, "Current Office file path is required.");
  const message = requireValue(elements.message, "Version message is required.");

  await apiPost("/api/init", { workspace });
  const result = await apiPost("/api/save-version", { workspace, filePath, message });
  elements.message.value = "";
  updateSaveButtonState();
  await loadHistory();
}

async function loadHistory() {
  const workspace = requireValue(elements.workspace, "Workspace folder is required.");
  const filePath = elements.filePath.value.trim();
  const result = await apiPost("/api/log", { workspace, filePath });
  renderHistory(result.records);
}

function detectCurrentFile() {
  const rawUrl = Office.context?.document?.url ?? "";
  const detected = officeUrlToPath(rawUrl);
  if (detected) {
    elements.filePath.value = detected;
    // Auto-set workspace to the folder that contains this file.
    const dir = detected.substring(0, detected.lastIndexOf("\\"));
    if (dir) {
      elements.workspace.value = dir;
      localStorage.setItem("ovc.workspace", dir);
    }
  } else {
    console.warn("Could not detect a local file path. Save the document locally first.");
  }
  updateSaveButtonState();
}

async function apiPost(path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `OVC API request failed: ${path}`);
  }

  return data;
}

function renderHistory(records) {
  if (!records.length) {
    elements.history.textContent = "No history found.";
    return;
  }

  elements.history.textContent = "";
  for (const record of records) {
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = `<strong>${escapeHtml(record.id)}</strong> ${escapeHtml(record.message || "No message")}
      <small>${escapeHtml(record.createdAt)} · ${escapeHtml(record.originalName)} · ${escapeHtml(record.hash.slice(0, 12))}</small>`;
    elements.history.append(item);
  }
}

async function run(task) {
  try {
    await task();
  } catch (error) {
    console.error(error?.message || String(error));
  }
}

function requireValue(input, message) {
  const value = input.value.trim();
  if (!value) throw new Error(message);
  return value;
}

function officeUrlToPath(value) {
  if (!value) return "";

  try {
    const url = new URL(value);
    if (url.protocol === "file:") {
      return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/, "$1").replaceAll("/", "\\");
    }
  } catch {
    // Fall through to raw value handling.
  }

  return value.replace(/^file:\/+/, "").replaceAll("/", "\\");
}

function updateSaveButtonState() {
  const canSave = Boolean(
    elements.workspace.value.trim() &&
    elements.filePath.value.trim() &&
    elements.message.value.trim()
  );
  elements.saveVersion.disabled = !canSave;
  elements.saveVersion.title = canSave
    ? "Save this Office file as a new OVC version"
    : "Workspace, current file, and version message are required.";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
