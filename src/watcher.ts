import chokidar from "chokidar";
import fg from "fast-glob";
import path from "node:path";
import { isSupportedOfficeFile } from "./office/detect.js";
import type { VersionManager } from "./core/versionManager.js";

export interface WatchOptions {
  message?: string;
  debounceMs?: number;
}

export async function addExistingFiles(manager: VersionManager, patterns: string[]): Promise<void> {
  const files = await fg(patterns, {
    absolute: true,
    onlyFiles: true,
    ignore: ["**/.office-vcs/**", "**/~$*"]
  });

  for (const file of files.filter(isSupportedOfficeFile)) {
    await manager.saveVersion(file, { message: "Initial watched version" });
  }
}

export function watchOfficeFiles(manager: VersionManager, target: string, options: WatchOptions = {}): void {
  const pending = new Map<string, NodeJS.Timeout>();
  const root = path.resolve(target);

  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: ["**/.office-vcs/**", "**/~$*"]
  });

  const schedule = (filePath: string) => {
    if (!isSupportedOfficeFile(filePath)) return;

    const previous = pending.get(filePath);
    if (previous) clearTimeout(previous);

    pending.set(
      filePath,
      setTimeout(async () => {
        pending.delete(filePath);
        try {
          const record = await manager.saveVersion(filePath, {
            message: options.message ?? "Watched file update"
          });
          console.log(`${record.id} ${record.originalName} ${record.hash.slice(0, 12)}`);
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
        }
      }, options.debounceMs ?? 500)
    );
  };

  watcher.on("add", schedule);
  watcher.on("change", schedule);
  watcher.on("ready", () => {
    console.log(`Watching ${root}`);
  });
}
