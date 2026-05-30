use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use notify::{recommended_watcher, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Default)]
pub struct WorkspaceWatcherState {
    active: Mutex<Option<ActiveWatcher>>,
}

struct ActiveWatcher {
    workspace: PathBuf,
    _watcher: RecommendedWatcher,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceChangePayload {
    workspace: String,
    paths: Vec<String>,
}

impl WorkspaceWatcherState {
    pub fn watch(&self, app: AppHandle, workspace: String) -> Result<()> {
        let workspace_path = PathBuf::from(workspace).canonicalize()?;
        {
            let active = self
                .active
                .lock()
                .map_err(|_| "workspace watcher lock failed")?;
            if active
                .as_ref()
                .map(|item| item.workspace == workspace_path)
                .unwrap_or(false)
            {
                return Ok(());
            }
        }

        let payload_workspace = path_string(&workspace_path);
        let mut watcher = recommended_watcher(move |result: notify::Result<Event>| {
            let Ok(event) = result else {
                return;
            };

            let paths = event
                .paths
                .iter()
                .filter(|path| is_supported_workspace_change(path))
                .map(|path| path_string(path))
                .collect::<Vec<_>>();

            if paths.is_empty() {
                return;
            }

            let _ = app.emit(
                "workspace-files-changed",
                WorkspaceChangePayload {
                    workspace: payload_workspace.clone(),
                    paths,
                },
            );
        })?;
        watcher.watch(&workspace_path, RecursiveMode::Recursive)?;

        let mut active = self
            .active
            .lock()
            .map_err(|_| "workspace watcher lock failed")?;
        *active = Some(ActiveWatcher {
            workspace: workspace_path,
            _watcher: watcher,
        });
        Ok(())
    }
}

fn is_supported_workspace_change(path: &Path) -> bool {
    !is_internal_ovc_path(path)
}

fn is_internal_ovc_path(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|value| value.eq_ignore_ascii_case(".office-vcs"))
            .unwrap_or(false)
    })
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
