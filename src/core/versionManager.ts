import path from "node:path";
import type { Stats } from "node:fs";
import fs from "fs-extra";
import { sha256File } from "./hash.js";
import type {
  AddVersionOptions,
  CommitOptions,
  DiffVersionOptions,
  RepositoryPaths,
  RepositoryStatus,
  RestoreVersionOptions,
  StagedRecord,
  VersionRecord
} from "./types.js";
import { detectOfficeKind, isSupportedOfficeFile } from "../office/detect.js";
import { extractOfficeText } from "../office/extractText.js";
import { diffSnapshots } from "../office/diff.js";
import { MetadataStore } from "../storage/metadataStore.js";
import { ObjectStore } from "../storage/objectStore.js";

export class VersionManager {
  private readonly metadata: MetadataStore;
  private readonly objects: ObjectStore;

  constructor(private readonly paths: RepositoryPaths) {
    this.metadata = new MetadataStore(paths);
    this.objects = new ObjectStore(paths);
  }

  async init(): Promise<void> {
    await this.metadata.init();
  }

  async add(filePath: string): Promise<StagedRecord> {
    await this.init();
    const absolutePath = path.resolve(filePath);
    const stat = await this.validateOfficeFile(absolutePath);
    const hash = await sha256File(absolutePath);
    const staged: StagedRecord = {
      sourcePath: absolutePath,
      originalName: path.basename(absolutePath),
      kind: detectOfficeKind(absolutePath),
      hash,
      stagedAt: new Date().toISOString(),
      size: stat.size
    };

    await this.metadata.stage(absolutePath, staged);
    return staged;
  }

  async commit(options: CommitOptions): Promise<VersionRecord[]> {
    await this.init();
    const metadata = await this.metadata.read();
    const staged = Object.values(metadata.staged);

    if (staged.length === 0) {
      throw new Error("Nothing to commit. Use add <file> first.");
    }

    const committed: VersionRecord[] = [];
    const stagedKeys: string[] = [];

    for (const item of staged) {
      const record = await this.saveVersion(item.sourcePath, { message: options.message });
      committed.push(record);
      stagedKeys.push(item.sourcePath);
    }

    await this.metadata.clearStaged(stagedKeys);
    return committed;
  }

  async status(): Promise<RepositoryStatus> {
    await this.init();
    const metadata = await this.metadata.read();
    const modified: RepositoryStatus["modified"] = [];
    const missing: VersionRecord[] = [];

    for (const [sourcePath, versions] of Object.entries(metadata.files)) {
      const latest = versions.at(-1);
      if (!latest) continue;

      if (!(await fs.pathExists(sourcePath))) {
        missing.push(latest);
        continue;
      }

      const currentHash = await sha256File(sourcePath);
      if (currentHash !== latest.hash) {
        modified.push({
          sourcePath,
          originalName: latest.originalName,
          previousHash: latest.hash,
          currentHash
        });
      }
    }

    return {
      staged: Object.values(metadata.staged),
      modified,
      missing
    };
  }

  async log(filePath?: string): Promise<VersionRecord[]> {
    await this.init();

    if (filePath) {
      return this.list(filePath);
    }

    const metadata = await this.metadata.read();
    return Object.values(metadata.files)
      .flat()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveVersion(filePath: string, options: AddVersionOptions = {}): Promise<VersionRecord> {
    await this.init();
    const absolutePath = path.resolve(filePath);
    const stat = await this.validateOfficeFile(absolutePath);

    const hash = await sha256File(absolutePath);
    const existing = await this.metadata.list(absolutePath);
    const previous = existing.at(-1);

    if (previous?.hash === hash) {
      return previous;
    }

    const objectPath = await this.objects.saveObject(absolutePath, hash);
    const text = await this.extractTextSnapshot(absolutePath);
    const textPath = await this.objects.saveSnapshot(hash, text);
    const record: VersionRecord = {
      id: `v${existing.length + 1}`,
      sourcePath: absolutePath,
      originalName: path.basename(absolutePath),
      kind: detectOfficeKind(absolutePath),
      hash,
      objectPath,
      textPath,
      message: options.message ?? "",
      createdAt: new Date().toISOString(),
      size: stat.size
    };

    await this.metadata.add(absolutePath, record);
    return record;
  }

  async list(filePath: string): Promise<VersionRecord[]> {
    await this.init();
    return this.metadata.list(path.resolve(filePath));
  }

  async diff(filePath: string, options: DiffVersionOptions = {}): Promise<string> {
    const records = await this.list(filePath);
    if (records.length < 2 && (!options.from || !options.to)) {
      throw new Error("At least two versions are required to diff this file.");
    }

    const from = this.resolveVersion(records, options.from ?? records.at(-2)?.id);
    const to = this.resolveVersion(records, options.to ?? records.at(-1)?.id);
    return diffSnapshots(from, to);
  }

  async restore(filePath: string, options: RestoreVersionOptions = {}): Promise<string> {
    const records = await this.list(filePath);
    const record = this.resolveVersion(records, options.version ?? records.at(-1)?.id);
    const targetPath = path.resolve(options.output ?? filePath);

    if ((await fs.pathExists(targetPath)) && !options.force && !options.output) {
      throw new Error(`Target exists. Use --force to overwrite: ${targetPath}`);
    }

    await fs.ensureDir(path.dirname(targetPath));
    await fs.copy(record.objectPath, targetPath, { overwrite: true });
    return targetPath;
  }

  async checkout(filePath: string, options: RestoreVersionOptions = {}): Promise<string> {
    return this.restore(filePath, { ...options, force: options.force ?? true });
  }

  private async validateOfficeFile(absolutePath: string): Promise<Stats> {
    if (!(await fs.pathExists(absolutePath))) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    if (!isSupportedOfficeFile(absolutePath)) {
      throw new Error("Only .docx, .xlsx, and .pptx files are supported for text snapshots.");
    }

    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`Not a file: ${absolutePath}`);
    }

    if (stat.size < 4) {
      throw new Error(`Invalid Office file: ${absolutePath} is too small to be a valid .docx/.xlsx/.pptx file.`);
    }

    const signature = (await fs.readFile(absolutePath)).subarray(0, 4);
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
      throw new Error(`Invalid Office file: ${absolutePath} is not a valid zipped Office document.`);
    }

    return stat;
  }

  private async extractTextSnapshot(absolutePath: string): Promise<string> {
    try {
      return await extractOfficeText(absolutePath);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not read Office contents from ${absolutePath}. The file may be corrupted or not a real Office file. Cause: ${cause}`);
    }
  }

  private resolveVersion(records: VersionRecord[], id?: string): VersionRecord {
    if (!id) {
      throw new Error("Version id is required.");
    }

    const record = records.find((item) => item.id === id);
    if (!record) {
      const available = records.map((item) => item.id).join(", ") || "none";
      throw new Error(`Version not found: ${id}. Available versions: ${available}`);
    }

    return record;
  }
}
