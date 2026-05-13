import { Command } from "commander";
import { getRepositoryPaths } from "./storage/repositoryPaths.js";
import { VersionManager } from "./core/versionManager.js";
import { addExistingFiles, watchOfficeFiles } from "./watcher.js";

export function buildCli(): Command {
  const program = new Command();

  program
    .name("ovc")
    .description("A tiny TypeScript version manager for Office files.")
    .version("0.1.0")
    .option("-r, --repo <path>", "repository directory", ".office-vcs");

  const managerFor = () => {
    const options = program.opts<{ repo: string }>();
    return new VersionManager(getRepositoryPaths(options.repo));
  };

  program
    .command("init")
    .description("Create the local .office-vcs repository.")
    .action(async () => {
      const manager = managerFor();
      await manager.init();
      console.log("Initialized Office repository.");
    });

  program
    .command("add")
    .argument("<files...>", "Office files to stage")
    .description("Stage Office files for the next commit.")
    .action(async (files: string[]) => {
      for (const file of files) {
        const staged = await managerFor().add(file);
        console.log(`staged ${staged.originalName} ${staged.hash.slice(0, 12)}`);
      }
    });

  program
    .command("commit")
    .requiredOption("-m, --message <message>", "commit message")
    .description("Create versions for staged Office files.")
    .action(async (options: { message: string }) => {
      const records = await managerFor().commit({ message: options.message });
      for (const record of records) {
        console.log(`${record.id} ${record.originalName} ${record.hash.slice(0, 12)} ${record.message}`);
      }
    });

  program
    .command("status")
    .description("Show staged files and changed tracked files.")
    .action(async () => {
      const status = await managerFor().status();

      if (status.staged.length === 0 && status.modified.length === 0 && status.missing.length === 0) {
        console.log("nothing to commit, working tree clean");
        return;
      }

      if (status.staged.length > 0) {
        console.log("Changes to be committed:");
        for (const item of status.staged) {
          console.log(`  staged:   ${item.sourcePath}`);
        }
      }

      if (status.modified.length > 0) {
        console.log("Changes not staged for commit:");
        for (const item of status.modified) {
          console.log(`  modified: ${item.sourcePath}`);
        }
      }

      if (status.missing.length > 0) {
        console.log("Tracked files missing:");
        for (const item of status.missing) {
          console.log(`  deleted:  ${item.sourcePath}`);
        }
      }
    });

  program
    .command("snapshot")
    .argument("<file>", "Office file to version immediately")
    .option("-m, --message <message>", "version message", "")
    .description("Save a version immediately without staging.")
    .action(async (file: string, options: { message: string }) => {
      const record = await managerFor().saveVersion(file, { message: options.message });
      console.log(`${record.id} ${record.originalName} ${record.hash.slice(0, 12)}`);
    });

  program
    .command("log")
    .argument("[file]", "Office file")
    .description("Show version history.")
    .action(async (file?: string) => {
      const records = await managerFor().log(file);
      if (records.length === 0) {
        console.log("No versions found.");
        return;
      }

      for (const record of records) {
        const message = record.message ? ` ${record.message}` : "";
        console.log(`${record.id}\t${record.createdAt}\t${record.hash.slice(0, 12)}\t${record.size} bytes${message}`);
      }
    });

  program
    .command("list")
    .argument("<file>", "Office file")
    .description("Alias for log <file>.")
    .action(async (file: string) => {
      const records = await managerFor().log(file);
      if (records.length === 0) {
        console.log("No versions found.");
        return;
      }

      for (const record of records) {
        const message = record.message ? ` ${record.message}` : "";
        console.log(`${record.id}\t${record.createdAt}\t${record.hash.slice(0, 12)}\t${record.size} bytes${message}`);
      }
    });

  program
    .command("diff")
    .argument("<file>", "Office file")
    .option("--from <version>", "older version id")
    .option("--to <version>", "newer version id")
    .description("Show a unified diff of extracted Office text.")
    .action(async (file: string, options: { from?: string; to?: string }) => {
      const patch = await managerFor().diff(file, options);
      console.log(patch);
    });

  program
    .command("restore")
    .argument("<file>", "Office file")
    .option("-v, --version <version>", "version id")
    .option("-o, --output <path>", "restore to another path")
    .option("-f, --force", "overwrite the source file")
    .description("Restore a saved Office file version.")
    .action(async (file: string, options: { version?: string; output?: string; force?: boolean }) => {
      const restoredPath = await managerFor().restore(file, options);
      console.log(`Restored ${restoredPath}`);
    });

  program
    .command("checkout")
    .argument("<file>", "Office file")
    .option("-v, --version <version>", "version id")
    .option("-o, --output <path>", "restore to another path")
    .option("-f, --force", "overwrite the source file", true)
    .description("Restore a saved version, similar to git checkout.")
    .action(async (file: string, options: { version?: string; output?: string; force?: boolean }) => {
      const restoredPath = await managerFor().checkout(file, options);
      console.log(`Checked out ${restoredPath}`);
    });

  program
    .command("watch")
    .argument("<target>", "file or directory to watch")
    .option("-m, --message <message>", "version message")
    .option("--include-existing", "add existing Office files before watching")
    .description("Watch Office files and save a version when they change.")
    .action(async (target: string, options: { message?: string; includeExisting?: boolean }) => {
      const manager = managerFor();
      await manager.init();

      if (options.includeExisting) {
        await addExistingFiles(manager, [target]);
      }

      watchOfficeFiles(manager, target, { message: options.message });
    });

  program.hook("preAction", async () => {
    process.on("unhandledRejection", (reason) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      console.error(message);
      process.exitCode = 1;
    });
  });

  return program;
}
