export type OfficeKind = "docx" | "xlsx" | "pptx" | "office" | "unknown";

export interface VersionRecord {
  id: string;
  sourcePath: string;
  originalName: string;
  kind: OfficeKind;
  hash: string;
  objectPath: string;
  textPath: string;
  message: string;
  createdAt: string;
  size: number;
}

export interface StagedRecord {
  sourcePath: string;
  originalName: string;
  kind: OfficeKind;
  hash: string;
  stagedAt: string;
  size: number;
}

export interface RepositoryMetadata {
  schemaVersion: 1;
  files: Record<string, VersionRecord[]>;
  staged: Record<string, StagedRecord>;
}

export interface AddVersionOptions {
  message?: string;
}

export interface CommitOptions {
  message: string;
}

export interface DiffVersionOptions {
  from?: string;
  to?: string;
}

export interface RestoreVersionOptions {
  version?: string;
  output?: string;
  force?: boolean;
}

export interface RepositoryPaths {
  root: string;
  objects: string;
  snapshots: string;
  metadata: string;
}

export interface RepositoryStatus {
  staged: StagedRecord[];
  modified: Array<{
    sourcePath: string;
    originalName: string;
    previousHash: string;
    currentHash: string;
  }>;
  missing: VersionRecord[];
}
