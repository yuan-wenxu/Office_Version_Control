use std::{
    fs,
    path::{Path, PathBuf},
    thread,
};

use serde::Deserialize;
use tiny_http::{Header, Method, Response, Server, SslConfig, StatusCode};

use crate::core::VersionManager;

const PORT: u16 = 38655;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiBody {
    workspace: Option<String>,
    file_path: Option<String>,
    files: Option<Vec<String>>,
    message: Option<String>,
}

pub fn start_background_server() {
    thread::spawn(|| {
        if let Err(error) = run_server() {
            eprintln!("OVC local API failed to start: {error}");
        }
    });
}

fn run_server() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let root = addin_root();
    // Build a full PEM chain: leaf certificate followed by the CA certificate.
    // WebView2 (Chromium) requires the complete chain in the TLS handshake to
    // validate the certificate even when the CA is present in the trust store.
    let mut cert = fs::read(root.join("certs").join("ovc-localhost.crt"))?;
    let ca_cert = fs::read(root.join("certs").join("ovc-localhost-ca.crt"))?;
    cert.extend_from_slice(&ca_cert);
    let key = fs::read(root.join("certs").join("ovc-localhost.key"))?;
    let server = Server::https(
        format!("localhost:{PORT}"),
        SslConfig {
            certificate: cert,
            private_key: key,
        },
    )?;

    for request in server.incoming_requests() {
        handle_request(request, &root);
    }
    Ok(())
}

fn handle_request(mut request: tiny_http::Request, addin_root: &Path) {
    let method = request.method().clone();
    let path = request.url().split('?').next().unwrap_or("/").to_string();
    let result = match (&method, path.as_str()) {
        (&Method::Options, _) => bytes_response(204, Vec::new(), "text/plain; charset=utf-8"),
        (&Method::Get, "/api/health") => json(
            200,
            serde_json::json!({ "ok": true, "name": "ovc", "port": PORT }),
        ),
        (&Method::Get, path) if path.starts_with("/addin/") => serve_addin(path, addin_root),
        (&Method::Post, path) => handle_api_post(path, &mut request),
        _ => json(
            404,
            serde_json::json!({ "ok": false, "error": "Not found" }),
        ),
    };

    let _ = request.respond(with_cors(result));
}

fn handle_api_post(
    path: &str,
    request: &mut tiny_http::Request,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = match read_body(request) {
        Ok(body) => body,
        Err(error) => {
            return json(
                400,
                serde_json::json!({ "ok": false, "error": error.to_string() }),
            )
        }
    };
    let result = handle_api_post_inner(path, body);

    match result {
        Ok(value) => json(200, value),
        Err(error) => json(
            500,
            serde_json::json!({ "ok": false, "error": error.to_string() }),
        ),
    }
}

fn handle_api_post_inner(
    path: &str,
    body: ApiBody,
) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
    match path {
        "/api/init" => {
            manager(require_workspace(&body)?).init()?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "/api/status" => {
            let status = manager(require_workspace(&body)?).status()?;
            Ok(serde_json::json!({ "ok": true, "status": status }))
        }
        "/api/track" => {
            let workspace = require_workspace(&body)?;
            let manager = manager(workspace);
            let files = body
                .files
                .clone()
                .or_else(|| body.file_path.clone().map(|file| vec![file]))
                .unwrap_or_default();
            let mut staged = Vec::new();
            for file in files {
                staged.push(manager.add(file)?);
            }
            Ok(serde_json::json!({ "ok": true, "staged": staged }))
        }
        "/api/save-version" => {
            let workspace = require_workspace(&body)?;
            let file_path = body.file_path.clone().ok_or("filePath is required")?;
            let message = require_message(&body)?;
            let manager = manager(workspace);
            manager.add(file_path)?;
            let records = manager.commit_tracked_changes(message)?;
            Ok(serde_json::json!({ "ok": true, "records": records }))
        }
        "/api/commit" => {
            let records = manager(require_workspace(&body)?)
                .commit_tracked_changes(require_message(&body)?)?;
            Ok(serde_json::json!({ "ok": true, "records": records }))
        }
        "/api/log" => {
            let records = manager(require_workspace(&body)?).log(body.file_path.as_deref())?;
            Ok(serde_json::json!({ "ok": true, "records": records }))
        }
        _ => Ok(serde_json::json!({ "ok": false, "error": "Not found" })),
    }
}

fn read_body(
    request: &mut tiny_http::Request,
) -> Result<ApiBody, Box<dyn std::error::Error + Send + Sync>> {
    let mut text = String::new();
    request.as_reader().read_to_string(&mut text)?;
    if text.trim().is_empty() {
        return Ok(ApiBody {
            workspace: None,
            file_path: None,
            files: None,
            message: None,
        });
    }
    Ok(serde_json::from_str(&text)?)
}

fn require_workspace(body: &ApiBody) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    body.workspace
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| "workspace is required".into())
}

fn require_message(body: &ApiBody) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    body.message
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "message is required".into())
}

fn manager(workspace: String) -> VersionManager {
    VersionManager::new(PathBuf::from(workspace).join(".office-vcs"))
}

fn serve_addin(path: &str, root: &Path) -> Response<std::io::Cursor<Vec<u8>>> {
    let relative = path.trim_start_matches("/addin/").trim_start_matches('/');
    let relative = if relative.is_empty() {
        "taskpane.html"
    } else {
        relative
    };
    let file_path = root.join(relative);
    if !file_path.starts_with(root) {
        return json(
            400,
            serde_json::json!({ "ok": false, "error": "Invalid add-in path" }),
        );
    }

    match fs::read(&file_path) {
        Ok(bytes) => bytes_response(200, bytes, content_type(&file_path)),
        Err(_) => json(
            404,
            serde_json::json!({ "ok": false, "error": "Add-in file not found" }),
        ),
    }
}

pub fn addin_root() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_default();
    let candidates = [
        std::env::current_dir()
            .unwrap_or_default()
            .join("office-addin"),
        PathBuf::from("../office-addin"),
        PathBuf::from("office-addin"),
        exe_dir.join("office-addin"),
        exe_dir.join("resources").join("office-addin"),
        exe_dir.join("..").join("Resources").join("office-addin"),
    ];
    candidates
        .into_iter()
        .find(|path| path.join("taskpane.html").exists())
        .unwrap_or_else(|| PathBuf::from("office-addin"))
}

fn json(status: u16, value: serde_json::Value) -> Response<std::io::Cursor<Vec<u8>>> {
    bytes_response(
        status,
        serde_json::to_vec(&value).unwrap_or_default(),
        "application/json; charset=utf-8",
    )
}

fn bytes_response(
    status: u16,
    bytes: Vec<u8>,
    content_type: &str,
) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_data(bytes)
        .with_status_code(StatusCode(status))
        .with_header(Header::from_bytes("Content-Type", content_type).expect("valid header"))
}

fn with_cors(response: Response<std::io::Cursor<Vec<u8>>>) -> Response<std::io::Cursor<Vec<u8>>> {
    response
        .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").expect("valid header"))
        .with_header(
            Header::from_bytes("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
                .expect("valid header"),
        )
        .with_header(
            Header::from_bytes("Access-Control-Allow-Headers", "Content-Type")
                .expect("valid header"),
        )
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
    {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        _ => "application/octet-stream",
    }
}
