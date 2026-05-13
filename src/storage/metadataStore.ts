import fs from "fs-extra";
import type { RepositoryMetadata, RepositoryPaths, VersionRecord } from "../core/types.js";

const emptyMetadata = (): RepositoryMetadata => ({
  schemaVersion: 1,
  files: {},
  staged: {}
});

export class MetadataStore {
  constructor(private readonly paths: RepositoryPaths) {}

  async init(): Promise<void> {
    await fs.ensureDir(this.paths.root);
    await fs.ensureDir(this.paths.objects);
    await fs.ensureDir(this.paths.blobs);
    await fs.ensureDir(this.paths.packages);
    await fs.ensureDir(this.paths.snapshots);

    if (!(await fs.pathExists(this.paths.metadata))) {
      await fs.writeJson(this.paths.metadata, emptyMetadata(), { spaces: 2 });
    }
  }

  async read(): Promise<RepositoryMetadata> {
    await this.init();
    const metadata = (await fs.readJson(this.paths.metadata)) as Partial<RepositoryMetadata>;
    return {
      schemaVersion: 1,
      files: metadata.files ?? {},
      staged: metadata.staged ?? {}
    };
  }

  async write(metadata: RepositoryMetadata): Promise<void> {
    await fs.writeJson(this.paths.metadata, metadata, { spaces: 2 });
  }

  async list(fileKey: string): Promise<VersionRecord[]> {
    const metadata = await this.read();
    return metadata.files[fileKey] ?? [];
  }

  async add(fileKey: string, record: VersionRecord): Promise<void> {
    const metadata = await this.read();
    const records = metadata.files[fileKey] ?? [];
    metadata.files[fileKey] = [...records, record];
    await this.write(metadata);
  }

  async stage(fileKey: string, record: RepositoryMetadata["staged"][string]): Promise<void> {
    const metadata = await this.read();
    metadata.staged[fileKey] = record;
    await this.write(metadata);
  }

  async clearStaged(fileKeys: string[]): Promise<void> {
    const metadata = await this.read();
    for (const fileKey of fileKeys) {
      delete metadata.staged[fileKey];
    }
    await this.write(metadata);
  }
}
