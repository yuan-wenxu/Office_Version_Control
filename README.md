# OVC

OVC is a desktop version-control tool for Office files. It is now built with a
Rust core and a Tauri desktop GUI. The CLI and Electron/TypeScript runtime have
been removed.

OVC supports `.docx`, `.xlsx`, and `.pptx`. It stores Office files as
content-addressed package parts, so unchanged internal files can be reused
between versions. It also creates text snapshots for readable diffs.

## Features

- Tauri desktop app for Windows/Linux/macOS builds
- Office add-in task pane for Word, Excel, and PowerPoint
- Local `.office-vcs/` repository in each workspace
- Automatic detection of changed tracked files
- Commit detected changes without manually adding files again
- History, latest diff, and checkout/restore
- Deduplicated blob storage for Office package contents
- HTTPS local API for the Office add-in at `https://localhost:38655`

## Requirements

- Rust stable
- Cargo
- Tauri CLI 2.x
- Platform dependencies for Tauri

Install the Tauri prerequisites for your platform before building.

## Development

Run the desktop app:

```bash
cd src-tauri
cargo tauri dev
```

Check Rust compilation:

```bash
cd src-tauri
cargo check
```

Format Rust code:

```bash
cd src-tauri
cargo fmt
```

Build the desktop app:

```bash
cd src-tauri
cargo tauri build
```

On Windows this creates an NSIS installer. Build output is written under:

```text
src-tauri/target/release/bundle/nsis/
```

When cross-compiling from Linux for Windows:

```bash
cd src-tauri
cargo tauri build --target x86_64-pc-windows-gnu --bundles nsis
```

The Windows installer is written under:

```text
src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/
```

## Desktop App Usage

1. Open OVC.
2. Click `Workspace` and choose a folder.
3. Click `Init` to create `.office-vcs/`.
4. Click `Track files` and choose `.docx`, `.xlsx`, or `.pptx` files.
5. Enter a commit message.
6. Click `Commit detected changes`.
7. After editing tracked files, return to OVC and click `Commit detected changes` again.

The app automatically detects modified tracked files. New files still need to be
selected once with `Track files`.

## Office Add-in

The add-in files live in:

```text
office-addin/
```

The manifest is:

```text
office-addin/manifest.xml
```

The Tauri desktop app starts a local HTTPS API automatically:

```text
https://localhost:38655
```

Before sideloading the add-in on Windows, trust the local certificate:

```text
The Windows installer imports the certificate automatically for the current user.
```

If Office reports a localhost or certificate error, run the one-time setup from
an Administrator PowerShell window:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\office-addin\setup-office-addin.ps1
```

This installs the trusted certificate for the current Windows user and adds the
Office WebView localhost loopback exemption. It also creates a local trusted
add-in catalog at `\\<your-computer-name>\OVCOfficeAddinCatalog` and registers
it in Office.

If you run from the repository without installing the app, install only the
certificate manually:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\office-addin\install-office-addin-cert.ps1
```

To diagnose certificate or local API problems on Windows, open OVC first, then
run:

```powershell
.\office-addin\check-office-addin.ps1
```

Then restart Word, Excel, or PowerPoint and add OVC from the `Shared Folder`
tab in the Office Add-ins dialog.

If your Office build does not show a `Shared Folder` tab, use:

```text
Add-ins > More Add-ins > My Add-ins > Add a custom add-in > Add from file
```

Then choose:

```text
office-addin/manifest.xml
```

Current add-in features:

- Detect current local Office document path when Office exposes it
- Save the current document as a new OVC version
- Show version history for the current document

If Office cannot expose the local file path, paste the file path manually in the
task pane.

## Repository Data

Each workspace stores runtime data in `.office-vcs/`:

```text
.office-vcs/
├── metadata.json
├── blobs/
├── packages/
├── objects/
└── snapshots/
```

- `metadata.json` records tracked files, versions, hashes, messages, and paths
- `blobs/` stores deduplicated files from inside Office zip packages
- `packages/` stores one manifest per saved version
- `objects/` is kept for compatibility with older storage layouts
- `snapshots/` stores extracted text used by diff

Do not commit `.office-vcs/` to Git.

## Project Structure

```text
.
├── app/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── office-addin/
│   ├── certs/
│   ├── manifest.xml
│   ├── taskpane.html
│   ├── taskpane.css
│   └── taskpane.js
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── icons/
│   └── src/
│       ├── main.rs
│       ├── core.rs
│       ├── office.rs
│       └── api.rs
└── README.md
```

## Certificates

The HTTPS server at `https://localhost:38655` uses a self-signed TLS certificate.
The certificate files live in `office-addin/certs/`:

| File | Purpose | Committed |
|---|---|---|
| `ovc-localhost-ca.crt` | CA certificate (public) | ✅ yes |
| `ovc-localhost-ca.key` | CA private key | ❌ no — in `.gitignore` |
| `ovc-localhost.crt` | Server certificate (public) | ✅ yes |
| `ovc-localhost.key` | Server private key | ❌ no — in `.gitignore` |

### First-time setup after cloning

After cloning the repository, the `.key` files are not present.
Regenerate them with:

```bash
bash office-addin/certs/generate-certs.sh
```

Requires `openssl` (available in WSL, Git for Windows, Homebrew, or any Linux distro).

### After regenerating certificates

New certificates have a different CA fingerprint, so Windows will no longer trust
the old installed CA. Run the following in an Administrator PowerShell window:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\office-addin\uninstall-office-addin-cert.ps1
.\office-addin\setup-office-addin.ps1
```


## Limitations

OVC targets modern Office Open XML files only: `.docx`, `.xlsx`, and `.pptx`.
Older binary Office formats such as `.doc`, `.xls`, and `.ppt` are not
supported.

Text diff is best-effort. Restored Office files preserve document contents, but
their zip byte layout may not be byte-for-byte identical to the original because
the package is reconstructed from stored parts.
