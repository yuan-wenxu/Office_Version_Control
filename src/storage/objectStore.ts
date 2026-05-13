import path from "node:path";
import { createHash } from "node:crypto";
import fs from "fs-extra";
import JSZip from "jszip";
import type { RepositoryPaths } from "../core/types.js";

interface PackageManifest {
  schemaVersion: 1;
  sourceHash: string;
  originalName: string;
  createdAt: string;
  entries: PackageManifestEntry[];
}

interface PackageManifestEntry {
  name: string;
  dir: boolean;
  hash?: string;
  size?: number;
}

export class ObjectStore {
  constructor(private readonly paths: RepositoryPaths) {}

  async saveObject(sourcePath: string, hash: string): Promise<string> {
    await fs.ensureDir(this.paths.objects);
    const ext = path.extname(sourcePath).toLowerCase();
    const objectPath = path.join(this.paths.objects, `${hash}${ext}`);

    if (!(await fs.pathExists(objectPath))) {
      await fs.copy(sourcePath, objectPath, { overwrite: false });
    }

    return objectPath;
  }

  async saveOfficePackage(sourcePath: string, sourceHash: string): Promise<string> {
    await fs.ensureDir(this.paths.blobs);
    await fs.ensureDir(this.paths.packages);

    const manifestPath = path.join(this.paths.packages, `${sourceHash}.json`);
    if (await fs.pathExists(manifestPath)) {
      return manifestPath;
    }

    const zip = await JSZip.loadAsync(await fs.readFile(sourcePath));
    const entries: PackageManifestEntry[] = [];
    const names = Object.keys(zip.files).sort();

    for (const name of names) {
      const entry = zip.files[name];
      if (entry.dir) {
        entries.push({ name, dir: true });
        continue;
      }

      const data = await entry.async("nodebuffer");
      const hash = createHash("sha256").update(data).digest("hex");
      const blobPath = this.blobPath(hash);

      if (!(await fs.pathExists(blobPath))) {
        await fs.ensureDir(path.dirname(blobPath));
        await fs.writeFile(blobPath, data);
      }

      entries.push({
        name,
        dir: false,
        hash,
        size: data.length
      });
    }

    const manifest: PackageManifest = {
      schemaVersion: 1,
      sourceHash,
      originalName: path.basename(sourcePath),
      createdAt: new Date().toISOString(),
      entries
    };

    await fs.writeJson(manifestPath, manifest, { spaces: 2 });
    return manifestPath;
  }

  async restoreOfficePackage(manifestPath: string, targetPath: string): Promise<void> {
    const manifest = (await fs.readJson(manifestPath)) as PackageManifest;
    const zip = new JSZip();

    for (const entry of manifest.entries) {
      if (entry.dir) {
        zip.folder(entry.name);
        continue;
      }

      if (!entry.hash) {
        throw new Error(`Invalid package manifest entry without hash: ${entry.name}`);
      }

      const blobPath = this.blobPath(entry.hash);
      if (!(await fs.pathExists(blobPath))) {
        throw new Error(`Missing stored blob for ${entry.name}: ${entry.hash}`);
      }

      zip.file(entry.name, await fs.readFile(blobPath), { binary: true });
    }

    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE"
    });

    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, buffer);
  }

  async saveSnapshot(hash: string, text: string): Promise<string> {
    await fs.ensureDir(this.paths.snapshots);
    const snapshotPath = path.join(this.paths.snapshots, `${hash}.txt`);

    if (!(await fs.pathExists(snapshotPath))) {
      await fs.writeFile(snapshotPath, text, "utf8");
    }

    return snapshotPath;
  }

  private blobPath(hash: string): string {
    return path.join(this.paths.blobs, hash.slice(0, 2), hash);
  }
}
