# OVC

OVC is a TypeScript command-line tool for versioning Office files with a
Git-like workflow.

It stores `.docx`, `.xlsx`, and `.pptx` files as content-addressed Office
package parts, so unchanged internal files can be reused across versions. It
also extracts text snapshots so different versions can be compared with a
readable unified diff.

## Features

- Git-like commands: `init`, `add`, `commit`, `status`, `log`, `diff`, `checkout`
- Supports `.docx`, `.xlsx`, and `.pptx`
- Stores Office package parts as deduplicated blobs, not only extracted text
- Avoids duplicate versions when file content has not changed
- Generates text diffs from Office content
- Can watch a file or directory and create versions automatically
- Provides clear errors for corrupted or invalid Office files

## Requirements

- Node.js 20 or newer
- npm

## Installation

Install dependencies:

```bash
npm install
```

Build the project:

```bash
npm run build
```

Install the CLI locally on your machine:

```bash
npm run link:local
```

After that, the `ovc` command is available:

```bash
ovc --help
```

To remove the linked command:

```bash
npm run unlink:local
```

## Quick Start

Create a version repository in the current directory:

```bash
ovc init
```

Stage an Office file:

```bash
ovc add ./docs/report.docx
```

Check what is staged or modified:

```bash
ovc status
```

Create a committed version:

```bash
ovc commit -m "first draft"
```

View history:

```bash
ovc log ./docs/report.docx
```

Compare two versions:

```bash
ovc diff ./docs/report.docx --from v1 --to v2
```

Restore a version:

```bash
ovc checkout ./docs/report.docx --version v1
```

## Commands

### `ovc init`

Creates the local OVC repository.

```bash
ovc init
```

By default, OVC writes data to `.office-vcs/` in the current directory.

### `ovc add <files...>`

Stages one or more Office files for the next commit.

```bash
ovc add ./docs/report.docx ./docs/budget.xlsx
```

Only `.docx`, `.xlsx`, and `.pptx` files are supported.

### `ovc commit -m <message>`

Creates versions for all staged files.

```bash
ovc commit -m "update quarterly documents"
```

If a staged file has the same content as its latest version, OVC will not create
a duplicate stored object.

### `ovc status`

Shows staged files, modified tracked files, and missing tracked files.

```bash
ovc status
```

### `ovc log [file]`

Shows version history. Without a file, it shows all known versions.

```bash
ovc log
ovc log ./docs/report.docx
```

### `ovc diff <file>`

Shows a text diff between two versions.

```bash
ovc diff ./docs/report.docx --from v1 --to v2
```

If `--from` and `--to` are omitted, OVC compares the two latest versions:

```bash
ovc diff ./docs/report.docx
```

### `ovc checkout <file>`

Restores a saved version.

```bash
ovc checkout ./docs/report.docx --version v1
```

Restore to another path:

```bash
ovc checkout ./docs/report.docx --version v1 --output ./restored/report.docx
```

### `ovc snapshot <file>`

Creates a version immediately without staging.

```bash
ovc snapshot ./docs/report.docx -m "quick save"
```

### `ovc watch <target>`

Watches a file or directory and saves a version when supported Office files
change.

```bash
ovc watch ./docs
```

Add existing Office files before watching:

```bash
ovc watch ./docs --include-existing
```

## Custom Repository Path

Use `--repo <path>` to store OVC data somewhere other than `.office-vcs/`.

```bash
ovc --repo ./my-office-history init
ovc --repo ./my-office-history add ./docs/report.docx
ovc --repo ./my-office-history commit -m "first version"
```

## Repository Data

OVC stores runtime data in `.office-vcs/`:

```text
.office-vcs/
├── metadata.json
├── blobs/
├── packages/
├── objects/
└── snapshots/
```

- `metadata.json` records versions, staged files, paths, hashes, and messages
- `blobs/` stores deduplicated files from inside Office zip packages
- `packages/` stores one manifest per version, pointing to blobs
- `objects/` is kept for compatibility with older full-file versions
- `snapshots/` stores extracted text used by `diff`

Do not commit `.office-vcs/` to Git. It is ignored by `.gitignore`.

## Project Structure

```text
.
├── src/
│   ├── index.ts
│   ├── cli.ts
│   ├── watcher.ts
│   ├── core/
│   ├── office/
│   └── storage/
├── test/
├── package.json
├── package-lock.json
├── tsconfig.json
└── README.md
```

- `src/index.ts` is the CLI entry point
- `src/cli.ts` defines commands and command-line options
- `src/core/` contains the version-management logic
- `src/office/` detects Office files, extracts text, and creates diffs
- `src/storage/` reads and writes local repository data
- `src/watcher.ts` implements file watching
- `test/` contains automated verification for the core behavior

## Development

Run the CLI directly from TypeScript:

```bash
npm run dev -- --help
npm run dev -- init
```

Run tests:

```bash
npm test
```

Build JavaScript output:

```bash
npm run build
```

Check production dependencies:

```bash
npm audit --omit=dev
```

## Packaging

Create an installable npm package archive:

```bash
npm run pack:app
```

This creates a file like:

```text
ovc-1.0.0.tgz
```

Install that archive globally:

```bash
npm install -g ./ovc-1.0.0.tgz
ovc --help
```

## What To Commit To GitHub

Commit source, tests, config, and documentation:

```text
src/
test/
README.md
package.json
package-lock.json
tsconfig.json
.gitignore
```

Do not commit generated or local runtime files:

```text
node_modules/
dist/
.office-vcs/
*.tgz
coverage/
```

## Limitations

Office files are binary zip packages. OVC stores Office package parts as
deduplicated blobs and reconstructs files during restore. This saves space when
large internal parts, such as media files, do not change between versions.

Text diff is best-effort:

- `.docx` text is extracted with `mammoth`
- `.xlsx` sheet data is converted to CSV-like text with `exceljs`
- `.pptx` slide text is extracted from slide XML

Formatting, comments, formulas, embedded media, and advanced Office metadata may
not appear in text diffs. Restored Office files preserve document contents, but
their zip byte layout may not be identical to the original file because the
package is reconstructed from stored parts.
