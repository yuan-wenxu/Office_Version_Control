#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod certs;
mod core;
mod office;

use std::path::PathBuf;

use core::{DiffResult, RepositoryStatus, TrackedFile, VersionManager, VersionRecord};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[tauri::command]
fn select_workspace(window: tauri::WebviewWindow) -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Choose workspace")
        .set_parent(&window)
        .pick_folder()
        .map(path_to_string)
}

#[tauri::command]
fn select_office_files(window: tauri::WebviewWindow) -> Vec<String> {
    rfd::FileDialog::new()
        .set_title("Choose Office files")
        .add_filter("Office files", &["docx", "xlsx", "pptx"])
        .set_parent(&window)
        .pick_files()
        .unwrap_or_default()
        .into_iter()
        .map(path_to_string)
        .collect()
}

#[tauri::command]
fn select_office_file(window: tauri::WebviewWindow) -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Choose Office file")
        .add_filter("Office files", &["docx", "xlsx", "pptx"])
        .set_parent(&window)
        .pick_file()
        .map(path_to_string)
}

#[tauri::command]
fn select_output_file(window: tauri::WebviewWindow, default_path: String) -> Option<String> {
    let default = PathBuf::from(default_path);
    let mut dialog = rfd::FileDialog::new()
        .set_title("Restore version as")
        .set_parent(&window);
    if let Some(parent) = default.parent() {
        dialog = dialog.set_directory(parent);
    }
    if let Some(name) = default.file_name().and_then(|value| value.to_str()) {
        dialog = dialog.set_file_name(format!("restored-{name}"));
    }
    dialog.save_file().map(path_to_string)
}

#[tauri::command]
fn init_repo(workspace: String) -> Result<(), String> {
    manager(workspace).init().map_err(to_error)
}

#[tauri::command]
fn track_files(workspace: String, files: Vec<String>) -> Result<Vec<core::StagedRecord>, String> {
    let manager = manager(workspace);
    files
        .iter()
        .map(|file| manager.add(file))
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_error)
}

#[tauri::command]
fn status(workspace: String) -> Result<RepositoryStatus, String> {
    manager(workspace).status().map_err(to_error)
}

#[tauri::command]
fn commit_detected(workspace: String, message: String) -> Result<Vec<VersionRecord>, String> {
    manager(workspace)
        .commit_tracked_changes(message)
        .map_err(to_error)
}

#[tauri::command]
fn log(workspace: String, file_path: Option<String>) -> Result<Vec<VersionRecord>, String> {
    manager(workspace)
        .log(file_path.as_deref())
        .map_err(to_error)
}

#[tauri::command]
fn tracked_files(workspace: String) -> Result<Vec<TrackedFile>, String> {
    manager(workspace).tracked_files().map_err(to_error)
}

#[tauri::command]
fn diff_latest(workspace: String, file_path: String) -> Result<DiffResult, String> {
    manager(workspace).diff_latest(&file_path).map_err(to_error)
}

#[tauri::command]
fn diff_versions(
    workspace: String,
    file_path: String,
    from_version: String,
    to_version: String,
) -> Result<DiffResult, String> {
    manager(workspace)
        .diff_versions(&file_path, &from_version, &to_version)
        .map_err(to_error)
}

#[tauri::command]
fn checkout_version(
    workspace: String,
    file_path: String,
    version: String,
    output: String,
) -> Result<String, String> {
    manager(workspace)
        .checkout(&file_path, &version, &output)
        .map(path_to_string)
        .map_err(to_error)
}

fn main() {
    match handle_hidden_cli() {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }

    api::start_background_server();

    tauri::Builder::default()
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "显示 OVC", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 OVC", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("OVC - Office Version Control")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            select_workspace,
            select_office_files,
            select_office_file,
            select_output_file,
            init_repo,
            track_files,
            status,
            commit_detected,
            log,
            tracked_files,
            diff_latest,
            diff_versions,
            checkout_version
        ])
        .run(tauri::generate_context!())
        .expect("failed to run OVC");
}

fn handle_hidden_cli() -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let args = std::env::args().collect::<Vec<_>>();
    if args.get(1).map(String::as_str) == Some("--generate-office-certs") {
        let addin_root = args
            .get(2)
            .map(PathBuf::from)
            .unwrap_or_else(api::addin_root);
        certs::generate_office_certs(&addin_root)?;
        return Ok(true);
    }
    Ok(false)
}

fn manager(workspace: String) -> VersionManager {
    VersionManager::new(PathBuf::from(workspace).join(".office-vcs"))
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

fn to_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
