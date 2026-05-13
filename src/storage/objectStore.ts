import path from "node:path";
import fs from "fs-extra";
import type { RepositoryPaths } from "../core/types.js";

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

  async saveSnapshot(hash: string, text: string): Promise<string> {
    await fs.ensureDir(this.paths.snapshots);
    const snapshotPath = path.join(this.paths.snapshots, `${hash}.txt`);

    if (!(await fs.pathExists(snapshotPath))) {
      await fs.writeFile(snapshotPath, text, "utf8");
    }

    return snapshotPath;
  }
}
