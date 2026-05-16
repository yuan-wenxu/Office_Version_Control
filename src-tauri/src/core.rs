use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use flate2::{read::GzDecoder, write::GzEncoder, Compression};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use similar::TextDiff;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use crate::office::{detect_office_kind, extract_office_text, is_supported_office_file};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedRecord {
    pub source_path: String,
    pub original_name: String,
    pub kind: String,
    pub hash: String,
    pub staged_at: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRecord {
    pub id: String,
    pub source_path: String,
    pub original_name: String,
    pub kind: String,
    pub hash: String,
    pub object_path: String,
    pub storage_mode: String,
    pub manifest_path: String,
    pub text_path: String,
    pub message: String,
    pub created_at: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryStatus {
    pub staged: Vec<StagedRecord>,
    pub modified: Vec<ModifiedRecord>,
    pub missing: Vec<VersionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifiedRecord {
    pub source_path: String,
    pub original_name: String,
    pub previous_hash: String,
    pub current_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackedFile {
    pub source_path: String,
    pub original_name: String,
    pub kind: String,
    pub versions: usize,
    pub latest_hash: String,
    pub latest_created_at: String,
    pub size: u64,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryMetadata {
    schema_version: u8,
    files: HashMap<String, Vec<VersionRecord>>,
    staged: HashMap<String, StagedRecord>,
}

impl Default for RepositoryMetadata {
    fn default() -> Self {
        Self {
            schema_version: 1,
            files: HashMap::new(),
            staged: HashMap::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageManifest {
    schema_version: u8,
    source_hash: String,
    original_name: String,
    created_at: String,
    entries: Vec<PackageManifestEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageManifestEntry {
    name: String,
    dir: bool,
    hash: Option<String>,
    size: Option<u64>,
    #[serde(default)]
    compressed: bool,
}

#[derive(Debug, Clone)]
pub struct VersionManager {
    root: PathBuf,
}

impl VersionManager {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn init(&self) -> Result<()> {
        let is_new = !self.root.exists();
        fs::create_dir_all(self.objects())?;
        fs::create_dir_all(self.blobs())?;
        fs::create_dir_all(self.packages())?;
        fs::create_dir_all(self.snapshots())?;
        if is_new {
            try_set_hidden(&self.root);
        }
        if !self.metadata_path().exists() {
            self.write_metadata(&RepositoryMetadata::default())?;
        }
        Ok(())
    }

    pub fn add(&self, file_path: impl AsRef<Path>) -> Result<StagedRecord> {
        self.init()?;
        let path = normalize_existing_path(file_path.as_ref())?;
        let stat = validate_office_file(&path)?;
        let hash = sha256_file(&path)?;
        let source_path = self.source_key(&path)?;
        let record = StagedRecord {
            source_path,
            original_name: file_name(&path)?,
            kind: detect_office_kind(&path)?.to_string(),
            hash,
            staged_at: now()?,
            size: stat.len(),
        };

        let mut metadata = self.read_metadata()?;
        metadata
            .staged
            .insert(record.source_path.clone(), record.clone());
        self.write_metadata(&metadata)?;
        Ok(record)
    }

    pub fn commit_tracked_changes(&self, message: String) -> Result<Vec<VersionRecord>> {
        self.init()?;
        let message = message.trim().to_string();
        if message.is_empty() {
            return Err("Commit message is required.".into());
        }

        let status = self.status()?;
        let mut files = BTreeMap::new();
        for item in status.staged {
            files.insert(item.source_path.clone(), item.source_path);
        }
        for item in status.modified {
            files.insert(item.source_path.clone(), item.source_path);
        }

        if files.is_empty() {
            return Err(
                "Nothing to commit. Add a new Office file or modify a tracked file first.".into(),
            );
        }

        let mut committed = Vec::new();
        for file in files.values() {
            committed.push(self.save_version(file, &message)?);
        }

        let mut metadata = self.read_metadata()?;
        for file in files.keys() {
            metadata.staged.remove(file);
        }
        self.write_metadata(&metadata)?;
        Ok(committed)
    }

    pub fn status(&self) -> Result<RepositoryStatus> {
        self.init()?;
        let metadata = self.read_metadata()?;
        let mut modified = Vec::new();
        let mut missing = Vec::new();

        for (source_path, versions) in &metadata.files {
            let Some(latest) = versions.last() else {
                continue;
            };
            let path = self.resolve_source_path(source_path);
            if !path.exists() {
                missing.push(latest.clone());
                continue;
            }
            let current_hash = sha256_file(&path)?;
            if current_hash != latest.hash {
                modified.push(ModifiedRecord {
                    source_path: source_path.clone(),
                    original_name: latest.original_name.clone(),
                    previous_hash: latest.hash.clone(),
                    current_hash,
                });
            }
        }

        Ok(RepositoryStatus {
            staged: metadata.staged.values().cloned().collect(),
            modified,
            missing,
        })
    }

    pub fn log(&self, file_path: Option<&str>) -> Result<Vec<VersionRecord>> {
        self.init()?;
        let metadata = self.read_metadata()?;
        if let Some(file_path) = file_path.filter(|value| !value.trim().is_empty()) {
            let key = self.source_key_for_input(file_path)?;
            return Ok(metadata.files.get(&key).cloned().unwrap_or_default());
        }

        let mut records: Vec<_> = metadata.files.values().flatten().cloned().collect();
        records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(records)
    }

    pub fn tracked_files(&self) -> Result<Vec<TrackedFile>> {
        self.init()?;
        let metadata = self.read_metadata()?;
        let mut files = BTreeMap::new();

        for (source_path, records) in &metadata.files {
            let Some(latest) = records.last() else {
                continue;
            };
            files.insert(
                source_path.clone(),
                TrackedFile {
                    source_path: source_path.clone(),
                    original_name: latest.original_name.clone(),
                    kind: latest.kind.clone(),
                    versions: records.len(),
                    latest_hash: latest.hash.clone(),
                    latest_created_at: latest.created_at.clone(),
                    size: latest.size,
                    staged: metadata.staged.contains_key(source_path),
                },
            );
        }

        for (source_path, staged) in &metadata.staged {
            files
                .entry(source_path.clone())
                .or_insert_with(|| TrackedFile {
                    source_path: source_path.clone(),
                    original_name: staged.original_name.clone(),
                    kind: staged.kind.clone(),
                    versions: 0,
                    latest_hash: staged.hash.clone(),
                    latest_created_at: staged.staged_at.clone(),
                    size: staged.size,
                    staged: true,
                });
        }

        Ok(files.into_values().collect())
    }

    pub fn diff_latest(&self, file_path: &str) -> Result<String> {
        let records = self.log(Some(file_path))?;
        if records.len() < 2 {
            return Err("At least two versions are required to diff this file.".into());
        }

        let from = &records[records.len() - 2];
        let to = &records[records.len() - 1];
        self.diff_records(from, to)
    }

    pub fn diff_versions(&self, file_path: &str, from_id: &str, to_id: &str) -> Result<String> {
        let records = self.log(Some(file_path))?;
        let from = records
            .iter()
            .find(|item| item.id == from_id)
            .ok_or_else(|| format!("Version not found: {from_id}"))?;
        let to = records
            .iter()
            .find(|item| item.id == to_id)
            .ok_or_else(|| format!("Version not found: {to_id}"))?;
        self.diff_records(from, to)
    }

    pub fn checkout(&self, file_path: &str, version: &str, output: &str) -> Result<PathBuf> {
        let records = self.log(Some(file_path))?;
        let record = records
            .iter()
            .find(|item| item.id == version)
            .ok_or_else(|| format!("Version not found: {version}"))?;
        let output = PathBuf::from(output);
        restore_office_package(
            &self.resolve_stored_path(&record.manifest_path),
            &output,
            &self.blobs(),
        )?;
        Ok(output)
    }

    fn save_version(&self, file_path: &str, message: &str) -> Result<VersionRecord> {
        let path = normalize_existing_path(&self.resolve_source_path(file_path))?;
        let stat = validate_office_file(&path)?;
        let hash = sha256_file(&path)?;
        let source_path = self.source_key(&path)?;

        let metadata = self.read_metadata()?;
        let existing = metadata
            .files
            .get(&source_path)
            .cloned()
            .unwrap_or_default();
        if let Some(previous) = existing.last().filter(|item| item.hash == hash) {
            return Ok(previous.clone());
        }

        let manifest_path = save_office_package(&path, &hash, &self.blobs(), &self.packages())?;
        let text = extract_office_text(&path)?;
        let text_path = self.snapshots().join(format!("{hash}.txt"));
        if !text_path.exists() {
            fs::write(&text_path, text)?;
        }

        let record = VersionRecord {
            id: format!("v{}", existing.len() + 1),
            source_path,
            original_name: file_name(&path)?,
            kind: detect_office_kind(&path)?.to_string(),
            hash,
            object_path: self.stored_key(&manifest_path),
            storage_mode: "package".to_string(),
            manifest_path: self.stored_key(&manifest_path),
            text_path: self.stored_key(&text_path),
            message: message.to_string(),
            created_at: now()?,
            size: stat.len(),
        };

        let mut metadata = self.read_metadata()?;
        metadata
            .files
            .entry(record.source_path.clone())
            .or_default()
            .push(record.clone());
        self.write_metadata(&metadata)?;
        Ok(record)
    }

    fn read_metadata(&self) -> Result<RepositoryMetadata> {
        self.init()?;
        let content = fs::read_to_string(self.metadata_path())?;
        let metadata = serde_json::from_str(&content).unwrap_or_default();
        self.normalize_metadata(metadata)
    }

    fn write_metadata(&self, metadata: &RepositoryMetadata) -> Result<()> {
        fs::write(
            self.metadata_path(),
            serde_json::to_string_pretty(metadata)?,
        )?;
        Ok(())
    }

    fn metadata_path(&self) -> PathBuf {
        self.root.join("metadata.json")
    }

    fn objects(&self) -> PathBuf {
        self.root.join("objects")
    }

    fn blobs(&self) -> PathBuf {
        self.root.join("blobs")
    }

    fn packages(&self) -> PathBuf {
        self.root.join("packages")
    }

    fn snapshots(&self) -> PathBuf {
        self.root.join("snapshots")
    }

    fn workspace(&self) -> PathBuf {
        self.root
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."))
    }

    fn source_key(&self, absolute_path: &Path) -> Result<String> {
        let workspace = normalize_existing_path(&self.workspace())?;
        let path = normalize_existing_path(absolute_path)?;
        let relative = path.strip_prefix(&workspace).map_err(|_| {
            format!(
                "Tracked files must be inside the workspace: {}",
                workspace.display()
            )
        })?;
        Ok(path_string(relative))
    }

    fn source_key_for_input(&self, file_path: &str) -> Result<String> {
        let path = Path::new(file_path);
        if path.is_absolute() {
            return self.source_key(&normalize_existing_path(path)?);
        }
        Ok(path_string(path))
    }

    fn resolve_source_path(&self, file_path: &str) -> PathBuf {
        let path = PathBuf::from(file_path);
        if path.is_absolute() {
            path
        } else {
            self.workspace().join(path)
        }
    }

    fn stored_key(&self, path: &Path) -> String {
        path.strip_prefix(&self.workspace())
            .map(path_string)
            .unwrap_or_else(|_| path_string(path))
    }

    fn resolve_stored_path(&self, path: &str) -> PathBuf {
        let path = PathBuf::from(path);
        if path.is_absolute() {
            path
        } else {
            self.workspace().join(path)
        }
    }

    fn diff_records(&self, from: &VersionRecord, to: &VersionRecord) -> Result<String> {
        let old_text =
            fs::read_to_string(self.resolve_stored_path(&from.text_path)).unwrap_or_default();
        let new_text =
            fs::read_to_string(self.resolve_stored_path(&to.text_path)).unwrap_or_default();
        let diff = TextDiff::from_lines(&old_text, &new_text);
        let mut output = format!(
            "--- {} {}\n+++ {} {}\n",
            from.id, from.created_at, to.id, to.created_at
        );
        for change in diff.iter_all_changes() {
            output.push(change.tag().to_string().chars().next().unwrap_or(' '));
            output.push_str(change.value());
        }
        Ok(output)
    }

    fn normalize_metadata(&self, metadata: RepositoryMetadata) -> Result<RepositoryMetadata> {
        let mut files = HashMap::new();
        for (key, records) in metadata.files {
            let normalized_key = self.normalize_source_key(&key);
            let normalized_records = records
                .into_iter()
                .map(|mut record| {
                    record.source_path = self.normalize_source_key(&record.source_path);
                    record.object_path = self.normalize_stored_key(&record.object_path);
                    record.manifest_path = self.normalize_stored_key(&record.manifest_path);
                    record.text_path = self.normalize_stored_key(&record.text_path);
                    record
                })
                .collect::<Vec<_>>();
            files
                .entry(normalized_key)
                .or_insert_with(Vec::new)
                .extend(normalized_records);
        }

        let mut staged = HashMap::new();
        for (key, mut record) in metadata.staged {
            let normalized_key = self.normalize_source_key(&key);
            record.source_path = self.normalize_source_key(&record.source_path);
            staged.insert(normalized_key, record);
        }

        Ok(RepositoryMetadata {
            schema_version: metadata.schema_version,
            files,
            staged,
        })
    }

    fn normalize_source_key(&self, value: &str) -> String {
        let path = PathBuf::from(value);
        if path.is_absolute() {
            self.source_key(&path).unwrap_or_else(|_| value.to_string())
        } else {
            value.to_string()
        }
    }

    fn normalize_stored_key(&self, value: &str) -> String {
        let path = PathBuf::from(value);
        if path.is_absolute() {
            self.stored_key(&path)
        } else {
            value.to_string()
        }
    }
}

fn save_office_package(
    path: &Path,
    source_hash: &str,
    blobs: &Path,
    packages: &Path,
) -> Result<PathBuf> {
    fs::create_dir_all(blobs)?;
    fs::create_dir_all(packages)?;
    let manifest_path = packages.join(format!("{source_hash}.json"));
    if manifest_path.exists() {
        return Ok(manifest_path);
    }

    let file = File::open(path)?;
    let mut zip = ZipArchive::new(file)?;
    let mut entries = Vec::new();
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index)?;
        let name = entry.name().to_string();
        if entry.is_dir() {
            entries.push(PackageManifestEntry {
                name,
                dir: true,
                hash: None,
                size: None,
                compressed: false,
            });
            continue;
        }

        let mut data = Vec::new();
        entry.read_to_end(&mut data)?;
        let hash = sha256_bytes(&data);
        let blob_path = blob_path(blobs, &hash);
        if !blob_path.exists() {
            if let Some(parent) = blob_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut gz = GzEncoder::new(Vec::new(), Compression::default());
            gz.write_all(&data)?;
            fs::write(&blob_path, gz.finish()?)?;
        }
        entries.push(PackageManifestEntry {
            name,
            dir: false,
            hash: Some(hash),
            size: Some(data.len() as u64),
            compressed: true,
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));

    let manifest = PackageManifest {
        schema_version: 1,
        source_hash: source_hash.to_string(),
        original_name: file_name(path)?,
        created_at: now()?,
        entries,
    };
    fs::write(&manifest_path, serde_json::to_string_pretty(&manifest)?)?;
    Ok(manifest_path)
}

fn restore_office_package(manifest_path: &Path, target_path: &Path, blobs: &Path) -> Result<()> {
    let manifest: PackageManifest = serde_json::from_str(&fs::read_to_string(manifest_path)?)?;
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = File::create(target_path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for entry in manifest.entries {
        if entry.dir {
            zip.add_directory(entry.name, options)?;
            continue;
        }
        let hash = entry
            .hash
            .ok_or_else(|| format!("Missing blob hash for {}", entry.name))?;
        let raw = fs::read(blob_path(blobs, &hash))?;
        let data = if entry.compressed {
            let mut decoder = GzDecoder::new(&raw[..]);
            let mut out = Vec::new();
            decoder.read_to_end(&mut out)?;
            out
        } else {
            raw
        };
        zip.start_file(entry.name, options)?;
        zip.write_all(&data)?;
    }
    zip.finish()?;
    Ok(())
}

fn validate_office_file(path: &Path) -> Result<fs::Metadata> {
    if !is_supported_office_file(path) {
        return Err("Only .docx, .xlsx, and .pptx files are supported.".into());
    }
    let stat = fs::metadata(path)?;
    if !stat.is_file() {
        return Err(format!("Not a file: {}", path.display()).into());
    }
    if stat.len() < 4 {
        return Err(format!("Invalid Office file: {} is too small.", path.display()).into());
    }
    let mut signature = [0_u8; 2];
    File::open(path)?.read_exact(&mut signature)?;
    if signature != [0x50, 0x4b] {
        return Err(format!(
            "Invalid Office file: {} is not a zipped Office document.",
            path.display()
        )
        .into());
    }
    Ok(stat)
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let bytes = file.read(&mut buffer)?;
        if bytes == 0 {
            break;
        }
        hasher.update(&buffer[..bytes]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn sha256_bytes(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

fn blob_path(root: &Path, hash: &str) -> PathBuf {
    root.join(&hash[..2]).join(hash)
}

fn normalize_existing_path(path: &Path) -> Result<PathBuf> {
    path.canonicalize().map_err(|error| {
        io::Error::new(
            error.kind(),
            format!(
                "File not found or inaccessible: {} ({error})",
                path.display()
            ),
        )
        .into()
    })
}

fn file_name(path: &Path) -> Result<String> {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .ok_or_else(|| format!("Invalid file name: {}", path.display()).into())
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn now() -> Result<String> {
    Ok(OffsetDateTime::now_utc().format(&Rfc3339)?)
}

#[cfg(windows)]
fn try_set_hidden(path: &Path) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("attrib")
        .arg("+H")
        .arg(path)
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(windows))]
fn try_set_hidden(_path: &Path) {}
