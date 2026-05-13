import path from "node:path";
import type { RepositoryPaths } from "../core/types.js";

export function getRepositoryPaths(repoRoot = ".office-vcs"): RepositoryPaths {
  const root = path.resolve(repoRoot);
  return {
    root,
    objects: path.join(root, "objects"),
    blobs: path.join(root, "blobs"),
    packages: path.join(root, "packages"),
    snapshots: path.join(root, "snapshots"),
    metadata: path.join(root, "metadata.json")
  };
}
