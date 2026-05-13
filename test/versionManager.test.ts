import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { VersionManager } from "../src/core/versionManager.js";
import { getRepositoryPaths } from "../src/storage/repositoryPaths.js";

describe("VersionManager", () => {
  it("saves, lists, diffs, and restores xlsx versions", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "office-vcs-"));
    const repo = path.join(temp, ".office-vcs");
    const file = path.join(temp, "budget.xlsx");
    const restored = path.join(temp, "restored.xlsx");

    await writeWorkbook(file, [["Item", "Amount"], ["Paper", 10]]);
    const manager = new VersionManager(getRepositoryPaths(repo));

    const first = await manager.saveVersion(file, { message: "first" });
    await writeWorkbook(file, [["Item", "Amount"], ["Paper", 20]]);
    const second = await manager.saveVersion(file, { message: "second" });

    expect(first.id).toBe("v1");
    expect(second.id).toBe("v2");

    const versions = await manager.list(file);
    expect(versions).toHaveLength(2);
    expect(versions.map((item) => item.message)).toEqual(["first", "second"]);

    const patch = await manager.diff(file, { from: "v1", to: "v2" });
    expect(patch).toContain("-Paper,10");
    expect(patch).toContain("+Paper,20");

    await manager.restore(file, { version: "v1", output: restored });
    const rows = await readWorkbook(restored);
    expect(rows).toEqual([["Item", "Amount"], ["Paper", 10]]);
  });

  it("stages and commits files like git", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "office-vcs-"));
    const file = path.join(temp, "budget.xlsx");
    const manager = new VersionManager(getRepositoryPaths(path.join(temp, ".office-vcs")));

    await writeWorkbook(file, [["Item", "Amount"], ["Paper", 10]]);

    const staged = await manager.add(file);
    expect(staged.originalName).toBe("budget.xlsx");

    const statusBefore = await manager.status();
    expect(statusBefore.staged).toHaveLength(1);

    const committed = await manager.commit({ message: "first commit" });
    expect(committed).toHaveLength(1);
    expect(committed[0].id).toBe("v1");
    expect(committed[0].message).toBe("first commit");

    const statusAfter = await manager.status();
    expect(statusAfter.staged).toHaveLength(0);
    expect(statusAfter.modified).toHaveLength(0);
  });

  it("does not create a duplicate version for an unchanged file", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "office-vcs-"));
    const file = path.join(temp, "budget.xlsx");
    const manager = new VersionManager(getRepositoryPaths(path.join(temp, ".office-vcs")));

    await writeWorkbook(file, [["Item", "Amount"], ["Paper", 10]]);

    const first = await manager.saveVersion(file);
    const second = await manager.saveVersion(file);
    const versions = await manager.list(file);

    expect(second).toEqual(first);
    expect(versions).toHaveLength(1);
  });

  it("rejects fake Office files with a clear error", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "office-vcs-"));
    const file = path.join(temp, "broken.pptx");
    const manager = new VersionManager(getRepositoryPaths(path.join(temp, ".office-vcs")));

    await fs.writeFile(file, "abc");

    await expect(manager.add(file)).rejects.toThrow("too small to be a valid .docx/.xlsx/.pptx file");
  });
});

async function writeWorkbook(filePath: string, rows: unknown[][]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRows(rows);
  await workbook.xlsx.writeFile(filePath);
}

async function readWorkbook(filePath: string): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("Sheet1");
  if (!sheet) return [];

  const rows: unknown[][] = [];
  sheet.eachRow((row) => {
    rows.push(Array.isArray(row.values) ? row.values.slice(1) : []);
  });
  return rows;
}
